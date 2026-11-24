const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const openStatuses = "('new','documents_requested','documents_received','under_review','aecb_report_requested','aecb_report_received','bank_negotiation','offer_proposed','client_approval','settlement_agreed','payment_plan_active','monitoring','on_hold')";
    const [cases, byStatus, revenue, enquiriesNew, customersCount, docs, recent] = await Promise.all([
      db.one(
        `SELECT COUNT(*) total,
                SUM(CASE WHEN status IN ${openStatuses} THEN 1 ELSE 0 END) open_cases,
                SUM(CASE WHEN priority = 'high' AND status IN ${openStatuses} THEN 1 ELSE 0 END) \`high_priority\`,
                SUM(CASE WHEN DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) new_30d
         FROM cases`),
      db.query('SELECT status, COUNT(*) n FROM cases GROUP BY status'),
      db.one(
        `SELECT COALESCE(SUM(vat_amount + subtotal),0) invoiced,
                (SELECT COALESCE(SUM(amount),0) FROM payments) collected
         FROM invoices WHERE status IN ('sent','partial','paid') AND issue_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`),
      db.one("SELECT COUNT(*) n FROM enquiries WHERE status = 'new'"),
      db.one('SELECT COUNT(*) n FROM customers WHERE status = "active"'),
      db.one('SELECT COUNT(*) n, COALESCE(SUM(size),0) bytes FROM documents'),
      db.query(
        `SELECT a.action, a.entity, a.entity_id, a.created_at, u.full_name user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 12`),
    ]);
    const monthRows = await db.query(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m') ym, SUM(amount) total FROM payments
       WHERE paid_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY ym ORDER BY ym`);
    res.json({ cases, byStatus, revenue, enquiriesNew, customersCount, docs, recent, monthRows });
  } catch (e) { next(e); }
});

module.exports = router;
