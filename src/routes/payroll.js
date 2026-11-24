const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, audit } = require('../middleware');

function round2(n) { return Math.round(n * 100) / 100; }

router.get('/', requireAuth, requirePermission('payroll.view'), async (req, res, next) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (req.query.period) { where += ' AND p.period = ?'; params.push(req.query.period); }
    if (req.query.branch_id) { where += ' AND p.branch_id = ?'; params.push(req.query.branch_id); }
    const sql = `SELECT p.*, b.name branch_name FROM payroll p
                 LEFT JOIN branches b ON b.id = p.branch_id ${where}
                 ORDER BY p.period DESC, p.employee_name LIMIT 400`;
    res.json(await db.query(sql, params));
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requirePermission('payroll.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(String(b.period || ''))) return res.status(400).json({ error: 'period must be YYYY-MM' });
    if (!b.employee_name) return res.status(400).json({ error: 'employee_name is required' });
    const basic = Number(b.basic) || 0, allow = Number(b.allowances) || 0, ded = Number(b.deductions) || 0;
    const r = await db.query(
      `INSERT INTO payroll (period, branch_id, employee_name, user_id, basic, allowances, deductions, net, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [b.period, b.branch_id || null, b.employee_name, b.user_id || null, basic, allow, ded, round2(basic + allow - ded), b.notes || null]
    );
    await audit(req, 'created', 'payroll', r.insertId, { period: b.period, employee: b.employee_name });
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requirePermission('payroll.edit'), async (req, res, next) => {
  try {
    const cur = await db.one('SELECT * FROM payroll WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Payroll entry not found' });
    const b = req.body || {};
    const basic = b.basic != null ? Number(b.basic) : Number(cur.basic);
    const allow = b.allowances != null ? Number(b.allowances) : Number(cur.allowances);
    const ded = b.deductions != null ? Number(b.deductions) : Number(cur.deductions);
    const status = ['draft', 'paid'].includes(b.status) ? b.status : cur.status;
    await db.query(
      `UPDATE payroll SET employee_name=?, branch_id=?, basic=?, allowances=?, deductions=?, net=?, status=?, paid_at=? WHERE id=?`,
      [b.employee_name || cur.employee_name, b.branch_id != null ? b.branch_id : cur.branch_id, basic, allow, ded,
        round2(basic + allow - ded), status,
        status === 'paid' ? (cur.paid_at || new Date()) : null, cur.id]
    );
    await audit(req, 'updated', 'payroll', cur.id, { status });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
