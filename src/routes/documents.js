const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const { encryptBuffer, sha256 } = require('../crypto');
const { requireAuth, requirePermission, audit } = require('../middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.get('/', requireAuth, requirePermission('documents.view'), async (req, res, next) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (req.query.customer_id) { where += ' AND d.customer_id = ?'; params.push(req.query.customer_id); }
    if (req.query.case_id) { where += ' AND d.case_id = ?'; params.push(req.query.case_id); }
    if (req.query.doc_type) { where += ' AND d.doc_type = ?'; params.push(req.query.doc_type); }
    const q = String(req.query.q || '').trim();
    if (q) { where += ' AND (d.title LIKE ? OR d.original_name LIKE ?)'; const like = `%${q}%`; params.push(like, like); }
    const sql = `SELECT d.id, d.customer_id, d.case_id, d.title, d.doc_type, d.original_name, d.mime, d.size,
                        d.created_at, cu.full_name customer_name, cu.code customer_code, c.case_no
                 FROM documents d
                 JOIN customers cu ON cu.id = d.customer_id
                 LEFT JOIN cases c ON c.id = d.case_id ${where}
                 ORDER BY d.created_at DESC LIMIT 300`;
    res.json(await db.query(sql, params));
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requirePermission('documents.upload'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (form field name: file)' });
    const b = req.body || {};
    if (!b.customer_id) return res.status(400).json({ error: 'customer_is_required: pick a customer' });
    const enc = encryptBuffer(req.file.buffer);
    const { nextNo } = await db.one('SELECT COALESCE(MAX(id),0)+1 AS nextNo FROM documents');
    const relPath = `documents/doc-${nextNo}.bin`;
    fs.writeFileSync(path.join(config.storageDir, relPath), enc);
    const r = await db.query(
      `INSERT INTO documents (customer_id, case_id, uploaded_by, title, doc_type, original_name, mime, size, storage_path, sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [b.customer_id, b.case_id || null, req.user.id, b.title || req.file.originalname,
        b.doc_type || 'other', req.file.originalname, req.file.mimetype || 'application/octet-stream',
        req.file.size, relPath, sha256(req.file.buffer)]
    );
    await audit(req, 'uploaded', 'document', r.insertId, { title: b.title || req.file.originalname });
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requirePermission('documents.delete'), async (req, res, next) => {
  try {
    const doc = await db.one('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const abs = path.join(config.storageDir, 'documents', path.basename(doc.storage_path));
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    await db.query('DELETE FROM documents WHERE id = ?', [doc.id]);
    await audit(req, 'deleted', 'document', doc.id, { title: doc.title });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
