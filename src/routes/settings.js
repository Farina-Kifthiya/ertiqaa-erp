const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, audit } = require('../middleware');

// public-ish: values needed by the UI before/without settings.edit permission
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const map = {};
    for (const s of await db.query('SELECT skey, svalue FROM settings')) map[s.skey] = s.svalue;
    res.json({ settings: map });
  } catch (e) { next(e); }
});

router.put('/', requireAuth, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    const map = req.body && req.body.settings;
    if (!map || typeof map !== 'object') return res.status(400).json({ error: 'settings object required' });
    for (const [k, v] of Object.entries(map)) {
      await db.query('INSERT INTO settings (skey, svalue) VALUES (?,?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)',
        [String(k).slice(0, 60), v == null ? null : String(v)]);
    }
    await audit(req, 'updated', 'settings', null, Object.keys(map));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- branches ----------
router.get('/branches', requireAuth, async (req, res, next) => {
  try {
    res.json(await db.query('SELECT * FROM branches ORDER BY is_head_office DESC, name'));
  } catch (e) { next(e); }
});

router.post('/branches', requireAuth, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.city) return res.status(400).json({ error: 'Branch name and city are required' });
    const r = await db.query(
      'INSERT INTO branches (name, city, address, phone, is_head_office) VALUES (?,?,?,?,?)',
      [b.name, b.city, b.address || null, b.phone || null, b.is_head_office ? 1 : 0]
    );
    await audit(req, 'created', 'branch', r.insertId, { name: b.name });
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.put('/branches/:id', requireAuth, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    const cur = await db.one('SELECT * FROM branches WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Branch not found' });
    const b = req.body || {};
    await db.query(
      'UPDATE branches SET name=?, city=?, address=?, phone=?, active=? WHERE id=?',
      [b.name || cur.name, b.city || cur.city, b.address != null ? b.address : cur.address,
        b.phone != null ? b.phone : cur.phone,
        b.active != null ? (b.active ? 1 : 0) : cur.active, cur.id]
    );
    await audit(req, 'updated', 'branch', cur.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- services ----------
router.get('/services', requireAuth, async (req, res, next) => {
  try {
    res.json(await db.query('SELECT * FROM services ORDER BY id'));
  } catch (e) { next(e); }
});

router.post('/services', requireAuth, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Service name is required' });
    const r = await db.query('INSERT INTO services (name, name_ar, description) VALUES (?,?,?)',
      [b.name, b.name_ar || null, b.description || null]);
    await audit(req, 'created', 'service', r.insertId, { name: b.name });
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.put('/services/:id', requireAuth, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    const cur = await db.one('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Service not found' });
    const b = req.body || {};
    await db.query(
      'UPDATE services SET name=?, name_ar=?, description=?, active=? WHERE id=?',
      [b.name || cur.name, b.name_ar != null ? b.name_ar : cur.name_ar,
        b.description != null ? b.description : cur.description,
        b.active != null ? (b.active ? 1 : 0) : cur.active, cur.id]
    );
    await audit(req, 'updated', 'service', cur.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
