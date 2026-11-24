const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, audit } = require('../middleware');

router.get('/', requireAuth, requirePermission('customers.view'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = 'WHERE c.status = ' + (req.query.include_archived ? "c.status" : "'active'");
    if (req.query.archived === '1') where = 'WHERE c.status = "archived"';
    let sql = `SELECT c.*, b.name branch_name FROM customers c LEFT JOIN branches b ON b.id = c.branch_id ${where}`;
    if (q) {
      sql += ' AND (c.full_name LIKE ? OR c.code LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY c.created_at DESC LIMIT 200';
    res.json(await db.query(sql, params));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, requirePermission('customers.view'), async (req, res, next) => {
  try {
    const c = await db.one(
      `SELECT c.*, b.name branch_name FROM customers c LEFT JOIN branches b ON b.id = c.branch_id WHERE c.id = ?`,
      [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'Customer not found' });
    c.cases = await db.query('SELECT id, case_no, status, opened_at, closed_at FROM cases WHERE customer_id = ? ORDER BY id DESC', [c.id]);
    c.invoices = await db.query('SELECT id, invoice_no, status, total, issue_date FROM invoices WHERE customer_id = ? ORDER BY id DESC', [c.id]);
    res.json(c);
  } catch (e) { next(e); }
});

function validate(body) {
  const errors = [];
  if (!body.full_name || !String(body.full_name).trim()) errors.push('Full name is required');
  if (!body.phone || !/^[+0-9 ()-]{7,20}$/.test(String(body.phone))) errors.push('A valid phone number is required');
  if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email))) errors.push('Email format is invalid');
  return errors;
}

router.post('/', requireAuth, requirePermission('customers.edit'), async (req, res, next) => {
  try {
    const errors = validate(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const b = req.body;
    const { nextId } = await db.one('SELECT COALESCE(MAX(id),0)+1 AS nextId FROM customers');
    const code = `CU-${String(nextId).padStart(4, '0')}`;
    const r = await db.query(
      `INSERT INTO customers (code, full_name, name_ar, email, phone, emirates_id, nationality, city, branch_id, source, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, b.full_name.trim(), b.name_ar || null, b.email || null, b.phone, b.emirates_id || null,
        b.nationality || null, b.city || null, b.branch_id || null, b.source || null, b.notes || null, req.user.id]
    );
    await audit(req, 'created', 'customer', r.insertId, { code });
    res.status(201).json({ id: r.insertId, code });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requirePermission('customers.edit'), async (req, res, next) => {
  try {
    const errors = validate(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const b = req.body;
    const r = await db.query(
      `UPDATE customers SET full_name=?, name_ar=?, email=?, phone=?, emirates_id=?, nationality=?, city=?, branch_id=?, source=?, status=?, notes=? WHERE id=?`,
      [b.full_name.trim(), b.name_ar || null, b.email || null, b.phone, b.emirates_id || null,
        b.nationality || null, b.city || null, b.branch_id || null, b.source || null,
        b.status === 'archived' ? 'archived' : 'active', b.notes || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Customer not found' });
    await audit(req, 'updated', 'customer', req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
