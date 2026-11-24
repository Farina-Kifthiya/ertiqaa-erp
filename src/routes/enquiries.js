const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, audit } = require('../middleware');

router.get('/', requireAuth, requirePermission('enquiries.view'), async (req, res, next) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (req.query.status) { where += ' AND e.status = ?'; params.push(req.query.status); }
    if (req.query.channel) { where += ' AND e.channel = ?'; params.push(req.query.channel); }
    const sql = `SELECT e.*, c.full_name customer_name, c.code customer_code, c.phone customer_phone,
                      s.name service_name, b.name branch_name, u.full_name assigned_name
               FROM enquiries e
               JOIN customers c ON c.id = e.customer_id
               LEFT JOIN services s ON s.id = e.service_id
               LEFT JOIN branches b ON b.id = e.branch_id
               LEFT JOIN users u ON u.id = e.assigned_to ${where}
               ORDER BY e.received_at DESC LIMIT 200`;
    res.json(await db.query(sql, params));
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requirePermission('enquiries.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.customer_id) return res.status(400).json({ error: 'customer_id is required' });
    const { nextId } = await db.one('SELECT COALESCE(MAX(id),0)+1 AS nextId FROM enquiries');
    const ref = `ENQ-M-${String(nextId).padStart(4, '0')}`;
    const r = await db.query(
      `INSERT INTO enquiries (ref, customer_id, channel, service_id, branch_id, assigned_to, status, message, received_at)
       VALUES (?,?,?,?,?,?,?,?,COALESCE(?, NOW()))`,
      [ref, b.customer_id, b.channel || 'other', b.service_id || null, b.branch_id || null,
        b.assigned_to || req.user.id, b.status || 'new', b.message || null, b.received_at || null]
    );
    await audit(req, 'created', 'enquiry', r.insertId, { ref, channel: b.channel || 'other' });
    res.status(201).json({ id: r.insertId, ref });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requirePermission('enquiries.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const r = await db.query(
      'UPDATE enquiries SET status = COALESCE(?, status), assigned_to = COALESCE(?, assigned_to), message = COALESCE(?, message) WHERE id = ?',
      [b.status || null, b.assigned_to || null, b.message || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Enquiry not found' });
    await audit(req, 'updated', 'enquiry', req.params.id, { status: b.status });
    if (b.status === 'converted' && b.create_case) {
      const enq = await db.one('SELECT * FROM enquiries WHERE id = ?', [req.params.id]);
      const { nextId } = await db.one('SELECT COALESCE(MAX(id),0)+1 AS nextId FROM cases');
      const caseNo = `ERC-${new Date().getFullYear()}-${String(nextId).padStart(4, '0')}`;
      const cr = await db.query(
        `INSERT INTO cases (case_no, customer_id, service_id, branch_id, assigned_to, status, opened_at, created_by)
         VALUES (?,?,?,?,?,'new',CURDATE(),?)`,
        [caseNo, enq.customer_id, enq.service_id, enq.branch_id, b.assigned_to || req.user.id, req.user.id]
      );
      await db.query('INSERT INTO case_history (case_id, user_id, to_status) VALUES (?,?,?)', [cr.insertId, req.user.id, 'new']);
      await audit(req, 'case_created_from_enquiry', 'enquiry', req.params.id, { case_no: caseNo });
      return res.json({ ok: true, case_id: cr.insertId, case_no: caseNo });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
