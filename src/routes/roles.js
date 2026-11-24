const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, audit } = require('../middleware');

router.get('/', requireAuth, requirePermission('roles.view'), async (req, res, next) => {
  try {
    const roles = await db.query('SELECT id, name, description, requires_2fa, is_system FROM roles ORDER BY id');
    const perms = await db.query('SELECT id, code, module, label FROM permissions ORDER BY module, id');
    const rp = await db.query('SELECT role_id, permission_id FROM role_permissions');
    const byRole = {};
    for (const r of rp) (byRole[r.role_id] = byRole[r.role_id] || []).push(r.permission_id);
    res.json({
      roles: roles.map((r) => ({ ...r, permissions: byRole[r.id] || [] })),
      permissions: perms,
    });
  } catch (e) { next(e); }
});

router.put('/:id/permissions', requireAuth, requirePermission('roles.edit'), async (req, res, next) => {
  try {
    const role = await db.one('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    const ids = [...new Set((req.body.permissions || []).map(Number).filter(Boolean))];
    const valid = (await db.query('SELECT id FROM permissions')).map((p) => p.id);
    const clean = ids.filter((i) => valid.includes(i));
    await db.query('DELETE FROM role_permissions WHERE role_id = ?', [role.id]);
    for (const pid of clean) {
      await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)', [role.id, pid]);
    }
    await audit(req, 'permissions_changed', 'role', role.id, { count: clean.length });
    res.json({ ok: true, permissions: clean });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requirePermission('roles.edit'), async (req, res, next) => {
  try {
    const role = await db.one('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    const b = req.body || {};
    await db.query(
      'UPDATE roles SET description = COALESCE(?, description), requires_2fa = ? WHERE id = ?',
      [b.description != null ? b.description : role.description,
        b.requires_2fa != null ? (b.requires_2fa ? 1 : 0) : role.requires_2fa, role.id]
    );
    await audit(req, 'updated', 'role', role.id, { requires_2fa: b.requires_2fa });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requirePermission('roles.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Role name is required' });
    const dup = await db.one('SELECT id FROM roles WHERE name = ?', [String(b.name).trim()]);
    if (dup) return res.status(400).json({ error: 'A role with this name already exists' });
    const r = await db.query(
      'INSERT INTO roles (name, description, requires_2fa) VALUES (?,?,?)',
      [String(b.name).trim(), b.description || null, b.requires_2fa ? 1 : 0]
    );
    await audit(req, 'created', 'role', r.insertId, { name: b.name });
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

module.exports = router;
