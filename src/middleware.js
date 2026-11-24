const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

function sign_jwt(user) {
  return jwt.sign({ sub: user.id, role: user.role_name }, config.jwtSecret, { expiresIn: '12h' });
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await db.one(
      `SELECT u.id, u.full_name, u.email, u.role_id, u.branch_id, u.status, u.twofa_enabled, u.must_change_password,
              r.name role_name, r.requires_2fa
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`,
      [payload.sub]
    );
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account is disabled' });
    if (user.requires_2fa && !user.twofa_enabled) {
      return res.status(403).json({ error: 'Two-factor authentication must be enabled for your role', code: '2FA_REQUIRED' });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

function requirePermission(code) {
  return async (req, res, next) => {
    try {
      const rows = await db.query(
        `SELECT 1 FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ? AND p.code = ?`,
        [req.user.role_id, code]
      );
      if (!rows.length) return res.status(403).json({ error: `You do not have permission: ${code}` });
      next();
    } catch (e) {
      next(e);
    }
  };
}

async function audit(req, action, entity, entityId, meta) {
  try {
    await db.query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, meta, ip) VALUES (?,?,?,?,?,?)',
      [req.user ? req.user.id : null, action, entity, entityId == null ? null : String(entityId),
        meta ? JSON.stringify(meta).slice(0, 500) : null, req.ip]
    );
  } catch (e) { /* auditing must never break a request */ }
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.expose || status < 500 ? err.message : 'Unexpected server error' });
}

module.exports = { sign_jwt, requireAuth, requirePermission, audit, errorHandler };
