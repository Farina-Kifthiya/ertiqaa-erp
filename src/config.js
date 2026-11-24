require('dotenv').config();
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(ROOT, 'storage');
for (const p of [STORAGE_DIR, path.join(STORAGE_DIR, 'documents'), path.join(STORAGE_DIR, 'backups')]) {
  fs.mkdirSync(p, { recursive: true });
}

const config = {
  root: ROOT,
  storageDir: STORAGE_DIR,
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ertiqaa_erp',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  encryptionKey: process.env.ENCRYPTION_KEY || 'dev-insecure-encryption-key-change-me',
  webhookSecret: process.env.WEBHOOK_SECRET || null,
  linkTtlSeconds: Number(process.env.LINK_TTL_SECONDS || 300),
  seedMode: (process.env.SEED_MODE || 'base').toLowerCase(),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@ertiqaa.ae',
  adminPassword: process.env.ADMIN_PASSWORD || null,
};

module.exports = config;
