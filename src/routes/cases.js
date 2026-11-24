const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, audit } = require('../middleware');

const STATUSES = ['new','documents_requested','documents_received','under_review','aecb_report_requested',
  'aecb_report_received','bank_negotiation','offer_proposed','client_approval','settlement_agreed',
  'payment_plan_active','monitoring','resolved','on_hold','rejected','withdrawn'];

router.get('/', requireAuth, requirePermission('cases.view'), async (req, res, next) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (req.query.status) { where += ' AND c.status = ?'; params.push(req.query.status); }
    if (req.query.branch_id) { where += ' AND c.branch_id = ?'; params.push(req.query.branch_id); }
    if (req.query.assigned_to) { where += ' AND c.assigned_to = ?'; params.push(req.query.assigned_to); }
    const q = String(req.query.q || '').trim();
    if (q) { where += ' AND (c.case_no LIKE ? OR cu.full_name LIKE ? OR cu.phone LIKE ?)'; const like = `%${q}%`; params.push(like, like, like); }
    const sql = `SELECT c.*, cu.full_name customer_name, cu.code customer_code, cu.phone customer_phone,
                        s.name service_name, b.name branch_name, u.full_name assigned_name
                 FROM cases c
                 JOIN customers cu ON cu.id = c.customer_id
                 LEFT JOIN services s ON s.id = c.service_id
                 LEFT JOIN branches b ON b.id = c.branch_id
                 LEFT JOIN users u ON u.id = c.assigned_to ${where}
                 ORDER BY c.updated_at DESC LIMIT 200`;
    res.json(await db.query(sql, params));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, requirePermission('cases.view'), async (req, res, next) => {
  try {
    const c = await db.one(
      `SELECT c.*, cu.full_name customer_name, cu.code customer_code, cu.phone customer_phone,
              cu.email customer_email, s.name service_name, b.name branch_name, u.full_name assigned_name
       FROM cases c
       JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN services s ON s.id = c.service_id
       LEFT JOIN branches b ON b.id = c.branch_id
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.id = ?`, [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    c.notes = await db.query(
      'SELECT n.id, n.note, n.created_at, u.full_name author FROM case_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.case_id = ? ORDER BY n.created_at DESC',
      [c.id]);
    c.history = await db.query(
      'SELECT h.id, h.from_status, h.to_status, h.created_at, u.full_name actor FROM case_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.case_id = ? ORDER BY h.created_at DESC',
      [c.id]);
    c.documents = await db.query(
      'SELECT id, title, doc_type, original_name, size, created_at FROM documents WHERE case_id = ? ORDER BY id DESC',
      [c.id]);
    res.json(c);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requirePermission('cases.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.customer_id) return res.status(400).json({ error: 'customer_id is required' });
    const { nextId } = await db.one('SELECT COALESCE(MAX(id),0)+1 AS nextId FROM cases');
    const caseNo = `ERC-${new Date().getFullYear()}-${String(nextId).padStart(4, '0')}`;
    const r = await db.query(
      `INSERT INTO cases (case_no, customer_id, service_id, branch_id, assigned_to, status, priority, notes, opened_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,COALESCE(?, CURDATE()),?)`,
      [caseNo, b.customer_id, b.service_id || null, b.branch_id || null, b.assigned_to || req.user.id,
        STATUSES.includes(b.status) ? b.status : 'new', ['low','normal','high'].includes(b.priority) ? b.priority : 'normal',
        b.notes || null, b.opened_at || null, req.user.id]
    );
    await db.query('INSERT INTO case_history (case_id, user_id, to_status) VALUES (?,?,?)', [r.insertId, req.user.id, 'new']);
    await audit(req, 'created', 'case', r.insertId, { case_no: caseNo });
    res.status(201).json({ id: r.insertId, case_no: caseNo });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requirePermission('cases.edit'), async (req, res, next) => {
  try {
    const cur = await db.one('SELECT * FROM cases WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Case not found' });
    const b = req.body || {};
    const newStatus = STATUSES.includes(b.status) ? b.status : cur.status;
    if (b.assigned_to && String(b.assigned_to) !== String(cur.assigned_to)) {
      const has = await db.one(
        'SELECT 1 AS h FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? AND p.code = ?',
        [req.user.role_id, 'cases.assign']);
      if (!has) return res.status(403).json({ error: 'You need the cases.assign permission to reassign cases' });
    }
    const closed = ['resolved', 'rejected', 'withdrawn'];
    await db.query(
      `UPDATE cases SET status=?, priority=COALESCE(?,priority), assigned_to=COALESCE(?,assigned_to),
              service_id=COALESCE(?,service_id), branch_id=COALESCE(?,branch_id), notes=COALESCE(?,notes),
              closed_at=? WHERE id=?`,
      [newStatus, b.priority || null, b.assigned_to || null, b.service_id || null, b.branch_id || null,
        b.notes || null, closed.includes(newStatus) ? new Date().toISOString().slice(0, 10) : cur.closed_at,
        req.params.id]
    );
    if (newStatus !== cur.status) {
      await db.query('INSERT INTO case_history (case_id, user_id, from_status, to_status) VALUES (?,?,?,?)',
        [cur.id, req.user.id, cur.status, newStatus]);
    }
    await audit(req, 'updated', 'case', cur.id, { status: newStatus });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/assign', requireAuth, requirePermission('cases.assign'), async (req, res, next) => {
  try {
    const { assigned_to } = req.body || {};
    const r = await db.query('UPDATE cases SET assigned_to = ? WHERE id = ?', [assigned_to || null, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Case not found' });
    await audit(req, 'assigned', 'case', req.params.id, { assigned_to });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/notes', requireAuth, requirePermission('cases.notes'), async (req, res, next) => {
  try {
    const note = String((req.body || {}).note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note text is required' });
    const r = await db.query('INSERT INTO case_notes (case_id, user_id, note) VALUES (?,?,?)', [req.params.id, req.user.id, note]);
    await audit(req, 'noted', 'case', req.params.id);
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

module.exports = router;
