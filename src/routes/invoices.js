const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, audit } = require('../middleware');

function round2(n) { return Math.round(n * 100) / 100; }

async function recomputeTotals(invoiceId, vatRate) {
  const rows = await db.query('SELECT COALESCE(SUM(line_total),0) AS s FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
  const subtotal = round2(Number(rows[0].s));
  const vatAmount = round2(subtotal * vatRate / 100);
  const total = round2(subtotal + vatAmount);
  await db.query('UPDATE invoices SET subtotal=?, vat_rate=?, vat_amount=?, total=? WHERE id=?',
    [subtotal, vatRate, vatAmount, total, invoiceId]);
  return { subtotal, vatAmount, total };
}

async function syncPaymentStatus(invoiceId) {
  const inv = await db.one('SELECT total, status FROM invoices WHERE id = ?', [invoiceId]);
  const paidRow = await db.one('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = ?', [invoiceId]);
  const paidAmt = round2(Number(paidRow.paid));
  if (inv.status === 'void') return inv.status;
  if (inv.status === 'draft' && paidAmt <= 0) return 'draft';
  let status = 'sent';
  if (paidAmt <= 0) status = 'sent';
  else if (paidAmt + 0.004 >= Number(inv.total)) status = 'paid';
  else status = 'partial';
  await db.query('UPDATE invoices SET status = ? WHERE id = ?', [status, invoiceId]);
  return status;
}

router.get('/', requireAuth, requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (req.query.status) { where += ' AND i.status = ?'; params.push(req.query.status); }
    const q = String(req.query.q || '').trim();
    if (q) { where += ' AND (i.invoice_no LIKE ? OR cu.full_name LIKE ?)'; const like = `%${q}%`; params.push(like, like); }
    const sql = `SELECT i.*, cu.full_name customer_name, cu.code customer_code, c.case_no, b.name branch_name
                 FROM invoices i
                 JOIN customers cu ON cu.id = i.customer_id
                 LEFT JOIN cases c ON c.id = i.case_id
                 LEFT JOIN branches b ON b.id = i.branch_id ${where}
                 ORDER BY i.id DESC LIMIT 200`;
    res.json(await db.query(sql, params));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const inv = await db.one(
      `SELECT i.*, cu.full_name customer_name, cu.code customer_code, cu.email customer_email,
              cu.phone customer_phone, c.case_no, b.name branch_name
       FROM invoices i
       JOIN customers cu ON cu.id = i.customer_id
       LEFT JOIN cases c ON c.id = i.case_id
       LEFT JOIN branches b ON b.id = i.branch_id WHERE i.id = ?`, [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    inv.items = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', [inv.id]);
    inv.payments = await db.query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC', [inv.id]);
    inv.amount_paid = round2(inv.payments.reduce((s, p) => s + Number(p.amount), 0));
    res.json(inv);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requirePermission('invoices.edit'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.customer_id) return res.status(400).json({ error: 'customer_is_required' });
    if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'At least one line item is required' });
    const s = await db.one("SELECT svalue FROM settings WHERE skey = 'vat_rate'");
    const vatRate = b.vat_rate != null ? Number(b.vat_rate) : Number(s ? s.svalue : 5);
    const trnRow = await db.one("SELECT svalue FROM settings WHERE skey = 'company_trn'");
    const { nextId } = await db.one('SELECT COALESCE(MAX(id),0)+1 AS nextId FROM invoices');
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(nextId).padStart(4, '0')}`;
    const issue = b.issue_date || new Date().toISOString().slice(0, 10);
    const due = b.due_date || issue;
    const r = await db.query(
      `INSERT INTO invoices (invoice_no, customer_id, case_id, branch_id, status, issue_date, due_date, vat_rate, trn, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [invoiceNo, b.customer_id, b.case_id || null, b.branch_id || null, ['draft','sent'].includes(b.status) ? b.status : 'draft',
        issue, due, vatRate, b.trn || (trnRow ? trnRow.svalue : null), b.notes || null, req.user.id]
    );
    for (const it of b.items) {
      const qty = Number(it.qty) || 1;
      const price = Number(it.unit_price) || 0;
      await db.query('INSERT INTO invoice_items (invoice_id, description, qty, unit_price, line_total) VALUES (?,?,?,?,?)',
        [r.insertId, String(it.description || 'Service').slice(0, 255), qty, price, round2(qty * price)]);
    }
    await recomputeTotals(r.insertId, vatRate);
    await audit(req, 'created', 'invoice', r.insertId, { invoice_no: invoiceNo });
    res.status(201).json({ id: r.insertId, invoice_no: invoiceNo });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requirePermission('invoices.edit'), async (req, res, next) => {
  try {
    const cur = await db.one('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Invoice not found' });
    if (['paid', 'void'].includes(cur.status)) return res.status(400).json({ error: 'Paid or void invoices cannot be edited' });
    const b = req.body || {};
    const vatRate = b.vat_rate != null ? Number(b.vat_rate) : Number(cur.vat_rate);
    await db.query(
      'UPDATE invoices SET case_id=?, status=?, issue_date=?, due_date=?, notes=? WHERE id=?',
      [b.case_id != null ? b.case_id : cur.case_id, ['draft','sent','void'].includes(b.status) ? b.status : cur.status,
        b.issue_date || cur.issue_date, b.due_date || cur.due_date, b.notes != null ? b.notes : cur.notes, cur.id]
    );
    if (Array.isArray(b.items) && b.items.length) {
      await db.query('DELETE FROM invoice_items WHERE invoice_id = ?', [cur.id]);
      for (const it of b.items) {
        const qty = Number(it.qty) || 1;
        const price = Number(it.unit_price) || 0;
        await db.query('INSERT INTO invoice_items (invoice_id, description, qty, unit_price, line_total) VALUES (?,?,?,?,?)',
          [cur.id, String(it.description || 'Service').slice(0, 255), qty, price, round2(qty * price)]);
      }
      await recomputeTotals(cur.id, vatRate);
    }
    await syncPaymentStatus(cur.id);
    await audit(req, 'updated', 'invoice', cur.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/payments', requireAuth, requirePermission('payments.record'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    const inv = await db.one('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'void') return res.status(400).json({ error: 'Cannot record payment on a void invoice' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });
    await db.query(
      'INSERT INTO payments (invoice_id, amount, method, reference, paid_at, recorded_by) VALUES (?,?,?,?,COALESCE(?, NOW()),?)',
      [inv.id, amount, ['cash','bank','card','other'].includes(b.method) ? b.method : 'bank',
        b.reference || null, b.paid_at || null, req.user.id]
    );
    await syncPaymentStatus(inv.id);
    await audit(req, 'payment_recorded', 'invoice', inv.id, { amount });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/void', requireAuth, requirePermission('invoices.void'), async (req, res, next) => {
  try {
    await db.query("UPDATE invoices SET status = 'void' WHERE id = ?", [req.params.id]);
    await audit(req, 'voided', 'invoice', req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/:id/pdf', requireAuth, requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const PDFDocument = require('pdfkit');
    const inv = await db.one(
      `SELECT i.*, cu.full_name customer_name, cu.code customer_code, cu.email customer_email,
              cu.phone customer_phone, c.case_no
       FROM invoices i JOIN customers cu ON cu.id = i.customer_id
       LEFT JOIN cases c ON c.id = i.case_id WHERE i.id = ?`, [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    inv.items = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', [inv.id]);
    inv.payments = await db.query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at', [inv.id]);
    const settings = {};
    for (const s of await db.query('SELECT skey, svalue FROM settings')) settings[s.skey] = s.svalue;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_no}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    const GOLD = '#d6a12e', DARK = '#1c1a16', GREY = '#6b675f';
    const money = (n) => Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    doc.rect(0, 0, 595, 110).fill(DARK);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(22).text('ERTIQAA', 50, 30);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(9)
      .text(String(settings.company_name_ar || ''), 50, 58)
      .text(String(settings.company_address || ''), 340, 34, { width: 210, align: 'right' })
      .text(`TRN: ${inv.trn || settings.company_trn || '-'}`, { align: 'right' })
      .text(String(settings.company_email || ''), { align: 'right' });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(16).text(`TAX INVOICE  ${inv.invoice_no}`, 50, 140);
    doc.font('Helvetica').fontSize(9).fillColor(GREY);
    doc.text(`Issued: ${inv.issue_date}    Due: ${inv.due_date}`, 50, 162);
    doc.text(`Status: ${String(inv.status).toUpperCase()}`, 50, 176);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('BILLED TO', 380, 140, { width: 170 });
    doc.font('Helvetica').fillColor(DARK).fontSize(9)
      .text(inv.customer_name, 380, 154, { width: 170 })
      .text(`${inv.customer_code} | ${inv.customer_phone || ''}`, { width: 170 })
      .text(inv.customer_email || '', { width: 170 });
    if (inv.case_no) doc.text(`Case: ${inv.case_no}`, { width: 170 });

    let y = 250;
    doc.rect(50, y, 495, 22).fill('#f3ede2');
    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(9)
      .text('DESCRIPTION', 60, y + 7).text('QTY', 380, y + 7).text('UNIT (AED)', 430, y + 7).text('TOTAL (AED)', 505, y + 7);
    y += 30;
    doc.font('Helvetica').fillColor(DARK);
    for (const it of inv.items) {
      doc.text(String(it.description).slice(0, 60), 60, y, { width: 300 })
        .text(String(it.qty), 380, y)
        .text(money(it.unit_price), 430, y)
        .text(money(it.line_total), 505, y);
      y += 20;
    }
    y += 8;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#ddd6c8').stroke();
    y += 12;
    doc.font('Helvetica-Bold').fillColor(DARK).fontSize(10);
    doc.text('Subtotal', 400, y); doc.text(money(inv.subtotal), 500, y); y += 18;
    doc.text(`VAT ${Number(inv.vat_rate)}%`, 400, y); doc.text(money(inv.vat_amount), 500, y); y += 18;
    doc.fontSize(12).fillColor(GOLD).text('TOTAL AED', 360, y); doc.text(money(inv.total), 500, y);
    y += 34;
    doc.fontSize(9).fillColor(GREY).font('Helvetica');
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    if (paid > 0) {
      doc.text(`Paid to date: AED ${money(paid)}   Balance: AED ${money(Number(inv.total) - paid)}`, 340, y, { width: 210 });
    }
    doc.fontSize(8).text(String(settings.invoice_footer || ''), 50, 770, { width: 495, align: 'center' });
    doc.end();
  } catch (e) { next(e); }
});

module.exports = router;
