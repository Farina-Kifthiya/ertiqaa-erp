const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const config = require('../config');
const db = require('../db');
const { decryptBuffer, verifyToken } = require('../crypto');
const { requireAuth, requirePermission, audit } = require('../middleware');

// issue a short-lived signed link for one document
router.post('/:id/link', requireAuth, requirePermission('documents.view'), async (req, res, next) => {
  try {
    const doc = await db.one('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const token = require('../crypto').signToken({ doc: doc.id, by: req.user.id }, config.linkTtlSeconds);
    await audit(req, 'link_issued', 'document', doc.id);
    res.json({ url: `/f/${token}`, expires_in: config.linkTtlSeconds, title: doc.title, original_name: doc.original_name });
  } catch (e) { next(e); }
});

// stream by signed token (no login needed - the token IS the authorisation, expires quickly)
async function serveByToken(req, res, next) {
  try {
    const data = verifyToken(req.params.token);
    const doc = await db.one('SELECT * FROM documents WHERE id = ?', [data.doc]);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const abs = path.join(config.storageDir, 'documents', path.basename(doc.storage_path));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File is not on disk' });
    const plain = decryptBuffer(fs.readFileSync(abs));
    res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${doc.original_name.replace(/["\\]/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(plain);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
}

function registerDownload(app) {
  app.get('/f/:token', serveByToken);
}

module.exports = router;
module.exports.serveByToken = serveByToken;
module.exports.registerDownload = registerDownload;
