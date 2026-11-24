const router = require('express').Router();
const db = require('../db');
const { audit } = require('../middleware');
const config = require('../config');

/**
 * Website-form webhook. Point the site's contact form at:
 *   POST /api/webhook/enquiry
 *   X-Webhook-Secret: <same value as WEBHOOK_SECRET in .env>
 *   JSON: { name, email, phone, service?, message? }
 * Creates (or matches by phone) a customer and logs the enquiry.
 */
router.post('/enquiry', async (req, res, next) => {
  try {
    if (!config.webhookSecret || req.headers['x-webhook-secret'] !== config.webhookSecret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });

    let customer = await db.one('SELECT id FROM customers WHERE phone = ? LIMIT 1', [phone]);
    if (!customer) {
      const { nextId } = await db.one('SELECT COALESCE(MAX(id),0)+1 AS nextId FROM customers');
      const code = `CU-${String(nextId).padStart(4, '0')}`;
      const ins = await db.query(
        'INSERT INTO customers (code, full_name, email, phone, source) VALUES (?,?,?,?,?)',
        [code, name, b.email || null, phone, 'Website']
      );
      customer = { id: ins.insertId };
    }

    let service = null;
    if (b.service) service = await db.one('SELECT id FROM services WHERE name LIKE ? LIMIT 1', [`%${b.service}%`]);

    const { nextId } = await db.one('SELECT COALESCE(MAX(id),0)+1 AS nextId FROM enquiries');
    const ref = `ENQ-W-${String(nextId).padStart(4, '0')}`;
    const r = await db.query(
      "INSERT INTO enquiries (ref, customer_id, channel, service_id, status, message) VALUES (?,?, 'website', ?, 'new', ?)",
      [ref, customer.id, service ? service.id : null, b.message || null]
    );
    await audit({ ...req, user: null }, 'webhook_enquiry', 'enquiry', r.insertId, { ref, ip: req.ip });
    res.status(201).json({ ok: true, enquiry_ref: ref, customer_id: customer.id });
  } catch (e) { next(e); }
});

module.exports = router;
