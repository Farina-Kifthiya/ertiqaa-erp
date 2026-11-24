/**
 * Runs on every app start (npm start) BEFORE the server:
 *  - waits for the database
 *  - creates the schema if it does not exist yet
 *  - if the database is empty, loads reference data using YOUR ENCRYPTION_KEY from .env:
 *      SEED_MODE=base  (default)  reference data + one administrator (ADMIN_EMAIL / ADMIN_PASSWORD)
 *      SEED_MODE=demo             fictional demo company data + demo documents (NEVER use with real clients)
 *      SEED_MODE=none             do nothing
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const { encryptBuffer, sha256 } = require('../src/crypto');

const mode = config.seedMode;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureDemoFiles(conn) {
  const [docs] = await conn.query('SELECT id, title, doc_type, original_name, storage_path FROM documents');
  let made = 0;
  for (const d of docs) {
    const abs = path.join(config.storageDir, 'documents', path.basename(d.storage_path));
    if (fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const body = Buffer.from(
      `ERTIQAA ERP - DEMO DOCUMENT (FICTIONAL)\n\nTitle: ${d.title}\nType: ${d.doc_type}\nFile: ${d.original_name}\n\nThis is placeholder content generated for the demo seed.\nIt is not a real document and holds no real personal data.\n`,
      'utf8'
    );
    fs.writeFileSync(abs, encryptBuffer(body));
    await conn.query('UPDATE documents SET size = ?, sha256 = ?, storage_path = ? WHERE id = ?', [
      body.length, sha256(body), `documents/${path.basename(abs)}`, d.id,
    ]);
    made++;
  }
  if (made) console.log(`[bootstrap] demo files created: ${made} (of ${docs.length} documents, encrypted with your ENCRYPTION_KEY)`);
}

(async () => {
  let conn;
  for (let i = 0; i < 60; i++) {
    try {
      conn = await mysql.createConnection({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        multipleStatements: true,
        charset: 'utf8mb4',
      });
      break;
    } catch (e) {
      if (i === 59) {
        console.error('[bootstrap] Database not reachable:', e.message);
        process.exit(1);
      }
      await sleep(2000);
    }
  }

  // create the database itself if it does not exist yet
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query("USE `" + config.db.database + "`");

  // ensure schema exists
  const [tables] = await conn.query(
    `SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = ? AND table_name = 'users'`,
    [config.db.database]
  );
  if (tables[0].n === 0) {
    let schemaSql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
    schemaSql = schemaSql.replace(/ertiqaa_erp/g, config.db.database);
    console.log('[bootstrap] schema not found - creating tables');
    await conn.query(schemaSql);
  }

  const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM users');
  if (n > 0 || mode === 'none') {
    console.log(`[bootstrap] database already initialised (${n} users) - skipping seed`);
    if (mode === 'demo') await ensureDemoFiles(conn);
    await conn.end();
    return;
  }
  if (mode !== 'base' && mode !== 'demo') {
    console.error(`[bootstrap] unknown SEED_MODE "${mode}" - use base, demo or none`);
    process.exit(1);
  }

  const file = path.join(os.tmpdir(), `ertiqaa-seed-${Date.now()}.sql`);
  const args = [path.join(__dirname, 'build-seed.js'), `--out=${file}`, ...(mode === 'demo' ? [] : ['--base'])];
  const res = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env, cwd: path.join(__dirname, '..') });
  if (res.status !== 0) {
    console.error('[bootstrap] seed generation failed');
    process.exit(1);
  }

  const sql = fs.readFileSync(file, 'utf8').replace(/^USE .*;/m, `USE \`${config.db.database}\`;`);
  await conn.query(sql);
  fs.unlinkSync(file);
  console.log(`[bootstrap] ${mode} seed loaded`);

  if (mode === 'demo') await ensureDemoFiles(conn);

  await conn.end();
})().catch((e) => {
  console.error('[bootstrap] failed:', e);
  process.exit(1);
});
