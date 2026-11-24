/**
 * Creates a full SQL backup of the Ertiqaa ERP database in storage/backups/.
 * Pure Node - no mysqldump needed, works on Windows/macOS/Linux.
 *
 *   npm run backup
 *
 * Tip (Windows Task Scheduler / cron):  cd /d C:\path\to\ertiqaa-erp && npm run backup
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const config = require('../src/config');

// import source structure to reuse the pool
const { getPool } = require(path.join(__dirname, '../src/db'));

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\n/g, '\\n')}'`;
};

(async () => {
  const conn = await getPool().getConnection();
  const [tables] = await conn.query('SHOW TABLES');
  const names = tables.map((r) => Object.values(r)[0]);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(config.storageDir, 'backups', `ertiqaa-${stamp}.sql`);

  const lines = ['-- Ertiqaa ERP backup', `-- generated ${new Date().toISOString()}`, 'SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS = 0;', `USE \`${config.db.database}\`;`, ''];
  for (const t of names) {
    const [[create]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
    lines.push(`DROP TABLE IF EXISTS \`${t}\`;`, create['Create Table'] + ';', '');
    const rows = await conn.query(`SELECT * FROM \`${t}\``);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      lines.push(`INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ` +
        chunk.map((r) => '(' + cols.map((c) => {
          let v = r[c];
          if (Buffer.isBuffer(v)) v = v.toString();
          if (typeof v === 'bigint') v = Number(v);
          return esc(v);
        }).join(',') + ');').join('\n'));
    }
    lines.push('');
  }
  lines.push('SET FOREIGN_KEY_CHECKS = 1;');
  fs.writeFileSync(file, lines.join('\n'));
  conn.release();
  console.log(`backup written: ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB, ${names.length} tables)`);
  process.exit(0);
})().catch((e) => {
  console.error('backup failed:', e.message);
  process.exit(1);
});
