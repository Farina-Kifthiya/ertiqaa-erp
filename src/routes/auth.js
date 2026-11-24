const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign_jwt, audit } = require('../middleware');
const totp = require('../totp');

const GENERIC = 'Invalid email or password';

router.post('/login', async (req, res, next) => {
  try {
    const { email, password, token } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = await db.one(
      `SELECT u.*, r.name role_name, r.requires_2fa
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
      [String(email).trim().toLowerCase()]
    );
    if (!user || user.status !== 'active' || !bcrypt.compareSync(String(password), user.password_hash)) {
      return res.status(401).json({ error: GENERIC });
    }

    const needsSetup = user.requires_2fa && !user.twofa_enabled;
    if (needsSetup || user.twofa_enabled) {
      let secret = user.twofa_secret;
      if (needsSetup && !secret) {
        secret = totp.generateSecret();
        await db.query('UPDATE users SET twofa_secret = ? WHERE id = ?', [secret, user.id]);
      }
      if (!token) {
        // provision a short-lived, narrowly-scoped token holding the pending user id
        const temp = sign_jwt_pending(user.id);
        return res.json({
          need2fa: true,
          need2fa_setup: needsSetup,
          tempToken: temp,
          secret: needsSetup ? secret : undefined,
          otpauth: needsSetup ? totp.otpauthUrl(secret, user.email) : undefined,
        });
      }
      let pending;
      try { pending = verifyPending(token); } catch { return res.status(401).json({ error: GENERIC }); }
      if (pending !== user.id) return res.status(401).json({ error: GENERIC });
      if (!totp.verifyToken(secret, token2(req))) {
        return res.status(401).json({ error: 'Invalid authentication code' });
      }
      if (needsSetup) await db.query('UPDATE users SET twofa_enabled = 1 WHERE id = ?', [user.id]);
    } else if (req.body.token) {
      return res.status(400).json({ error: 'This account does not use two-factor authentication' });
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await audit({ ...req, user: { id: user.id } }, 'login', 'user', user.id);
    const temp = user.must_change_password ? sign_jwt_pending(user.id) : null;
    res.json({
      token: sign_jwt(user),
      user: publicUser(user),
      mustChangePassword: !!user.must_change_password,
      changeToken: temp,
    });
  } catch (e) { next(e); }
});

// the 6-digit code arrives in "otp"; "token" carries the pending-2FA session token
const token2 = (req) => req.body.otp || req.body.code;

const jwt = require('jsonwebtoken');
const config = require('../config');
function sign_jwt_pending(id) {
  return jwt.sign({ pending: id, scope: 'pending2fa' }, config.jwtSecret, { expiresIn: '10m' });
}
function verifyPending(t) {
  const p = jwt.verify(t, config.jwtSecret);
  if (p.scope !== 'pending2fa') throw new Error('bad scope');
  return p.pending;
}

function publicUser(u) {
  return {
    id: u.id, full_name: u.full_name, email: u.email, role_id: u.role_id,
    role_name: u.role_name, branch_id: u.branch_id, requires_2fa: !!u.requires_2fa,
    twofa_enabled: !!u.twofa_enabled,
  };
}

const { requireAuth } = require('../middleware');
const crypto = require('../crypto');

router.get('/me', requireAuth, async (req, res) => {
  const perms = (await db.query(
    'SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?',
    [req.user.role_id])).map((r) => r.code);
  res.json({
    user: {
      id: req.user.id, full_name: req.user.full_name, email: req.user.email,
      role_id: req.user.role_id, role_name: req.user.role_name, branch_id: req.user.branch_id,
    },
    permissions: perms,
    mustChangePassword: !!req.user.must_change_password,
  });
});

router.post('/setup-2fa', requireAuth, async (req, res, next) => {
  try {
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET twofa_secret = ? WHERE id = ?', [secret, req.user.id]);
    res.json({ secret, otpauth: totp.otpauthUrl(secret, req.user.email) });
  } catch (e) { next(e); }
});

router.post('/confirm-2fa', requireAuth, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const user = await db.one('SELECT twofa_secret FROM users WHERE id = ?', [req.user.id]);
    if (!user.twofa_secret) return res.status(400).json({ error: 'Run setup first' });
    if (!totp.verifyToken(user.twofa_secret, token)) return res.status(400).json({ error: 'Invalid code - try the next one' });
    await db.query('UPDATE users SET twofa_enabled = 1 WHERE id = ?', [req.user.id]);
    await audit(req, '2fa_enabled', 'user', req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/disable-2fa', requireAuth, async (req, res, next) => {
  try {
    if (req.user.requires_2fa) {
      return res.status(403).json({ error: 'Your role requires two-factor authentication - it cannot be disabled' });
    }
    const { password } = req.body || {};
    const user = await db.one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!bcrypt.compareSync(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    await db.query('UPDATE users SET twofa_enabled = 0, twofa_secret = NULL WHERE id = ?', [req.user.id]);
    await audit(req, '2fa_disabled', 'user', req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/change-password', async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const current = auth.startsWith('Bearer ') ? auth.slice(7) : (req.body && req.body.tempToken);
    if (!current) return res.status(401).json({ error: 'Sign in first' });
    let id;
    try {
      const p = jwt.verify(current, config.jwtSecret);
      id = p.pending && p.scope === 'pending2fa' ? p.pending : p.sub;
    } catch { return res.status(401).json({ error: 'Session expired' }); }
    const { newPassword } = req.body || {};
    const pw = String(newPassword || '');
    if (pw.length < 10 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) {
      return res.status(400).json({ error: 'Password must be 10+ characters with upper, lower and a number' });
    }
    await db.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [bcrypt.hashSync(pw, 10), id]);
    await audit({ ...req, user: { id } }, 'password_changed', 'user', id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
