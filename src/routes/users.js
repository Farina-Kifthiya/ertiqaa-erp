const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requirePermission, audit } = require('../middleware');
const crypto = require('../crypto');
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

router.get('/', requireAuth, requirePermission('users.view'), async (req, res, next) => {
  try {
    res.json(await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role_id, r.name role_name, u.branch_id,
              b.name branch_name, u.twofa_enabled, u.status, u.last_login_at, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN branches b ON b.id = u.branch_id
       ORDER BY u.id`));
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requirePermission('users.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.full_name || !emailRe.test(String(b.email || ''))) {
      return res.status(400).json({ error: 'Full name and a valid email are required' });
    }
    if (!b.role_id) return res.status(400).json({ error: 'A role is required (see Roles & Permissions)' });
    const dup = await db.one('SELECT id FROM users WHERE email = ?', [String(b.email).toLowerCase()]);
    if (dup) return res.status(400).json({ error: 'A user with this email already exists' });
    const tempPassword = b.password || crypto.randomPassword();
    const r = await db.query(
      `INSERT INTO users (branch_id, role_id, full_name, email, phone, password_hash, must_change_password)
       VALUES (?,?,?,?,?,?,1)`,
      [b.branch_id || null, b.role_id, b.full_name, String(b.email).toLowerCase(), b.phone || null,
        bcrypt.hashSync(tempPassword, 10)]
    );
    await audit(req, 'created', 'user', r.insertId, { email: b.email });
    res.status(201).json({ id: r.insertId, temporary_password: tempPassword });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requirePermission('users.edit'), async (req, res, next) => {
  try {
    const cur = await db.one('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'User not found' });
    const b = req.body || {};
    await db.query(
      'UPDATE users SET full_name=?, phone=?, role_id=?, branch_id=?, status=? WHERE id=?',
      [b.full_name || cur.full_name, b.phone != null ? b.phone : cur.phone,
        b.role_id || cur.role_id, b.branch_id != null ? b.branch_id : cur.branch_id,
        ['active', 'disabled'].includes(b.status) ? b.status : cur.status, cur.id]
    );
    await audit(req, 'updated', 'user', cur.id, { status: b.status, role_id: b.role_id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/reset-password', requireAuth, requirePermission('users.edit'), async (req, res, next) => {
  try {
    const cur = await db.one('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'User not found' });
    const temp = crypto.randomPassword();
    await db.query('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
      [bcrypt.hashSync(temp, 10), cur.id]);
    await audit(req, 'password_reset', 'user', cur.id);
    res.json({ temporary_password: temp });
  } catch (e) { next(e); }
});

module.exports = router;
