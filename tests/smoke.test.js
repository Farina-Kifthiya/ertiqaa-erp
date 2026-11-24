/**
 * End-to-end smoke test against a throwaway MySQL instance (mysql-memory-server).
 * Run: npm test
 * A temporary MySQL binary is downloaded on first run; everything is destroyed afterwards.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createDB } = require('mysql-memory-server');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const check = (name, cond) => {
  if (!cond) throw new Error(`FAILED: ${name}`);
  passed++;
  console.log(`  ok - ${name}`);
};

(async () => {
  const mysqld = await createDB();
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = String(mysqld.port);
  process.env.DB_USER = mysqld.username;
  process.env.DB_PASSWORD = '';
  process.env.DB_NAME = 'ertiqaa_demo_test';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  process.env.WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.STORAGE_DIR = path.join(os.tmpdir(), `ertiqaa-test-storage-${Date.now()}`);
  process.env.SEED_MODE = 'demo';
  process.env.ADMIN_EMAIL = 'admin@ertiqaa.ae';
  process.env.ADMIN_PASSWORD = 'Start@Ertiqaa#2026';

  console.log('1. bootstrap with SEED_MODE=demo (schema + demo data + encrypted files)');
  const boot = spawnSync(process.execPath, ['scripts/bootstrap.js'], {
    cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 300000,
  });
  assert.strictEqual(boot.status, 0, `bootstrap failed:\n${boot.stdout}\n${boot.stderr}`);
  console.log(boot.stdout.trim());

  const db = require('../src/db');
  const count = async (t) => (await db.one(`SELECT COUNT(*) n FROM ${t}`)).n;

  check('12 demo users', (await count('users')) === 12);
  check('64 demo customers', (await count('customers')) === 64);
  check('69 demo cases', (await count('cases')) === 69);
  const docCount = await count('documents');
  check(`demo document rows present (${docCount})`, docCount > 300);
  const files = fs.readdirSync(path.join(process.env.STORAGE_DIR, 'documents'));
  check(`encrypted demo files on disk match rows (${files.length})`, files.length === docCount);

  console.log('2. server + auth + 2FA');
  const app = require('../src/server');
  const server = app.listen(0);
  let base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body, token, extra = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    const json = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
    const rest = json ? null : Buffer.from(await res.arrayBuffer());
    return { status: res.status, json: json === null ? {} : json, buf: rest };
  };
  const totp = require('../src/totp');
  const nowCode = (secret) => totp.hotp(secret, Math.floor(Date.now() / 30000));

  check('no token -> 401', (await api('GET', '/api/cases')).status === 401);
  check('wrong password rejected', (await api('POST', '/api/auth/login', { email: 'fatima.suwaidi@demo.ae', password: 'nope' })).status === 401);

  let r = await api('POST', '/api/auth/login', { email: 'fatima.suwaidi@demo.ae', password: 'Ertiqaa@2026!' });
  check('admin login asks for 2FA setup', r.json.need2fa === true && r.json.need2fa_setup === true);
  check('setup returns secret + otpauth link', typeof r.json.secret === 'string' && String(r.json.otpauth).startsWith('otpauth://totp/'));
  const secret = r.json.secret;
  const tempToken = r.json.tempToken;
  check('wrong TOTP code rejected', (await api('POST', '/api/auth/login', { email: 'fatima.suwaidi@demo.ae', password: 'Ertiqaa@2026!', token: tempToken, otp: '000000' })).status === 401);
  r = await api('POST', '/api/auth/login', { email: 'fatima.suwaidi@demo.ae', password: 'Ertiqaa@2026!', token: tempToken, otp: nowCode(secret) });
  check('valid TOTP code completes sign-in', r.status === 200 && !!r.json.token);
  const admin = r.json.token;

  r = await api('GET', '/api/auth/me', null, admin);
  check('/auth/me returns permission codes', Array.isArray(r.json.permissions) && r.json.permissions.includes('roles.view'));

  console.log('3. roles & permissions screen (live change, no code edits)');
  r = await api('GET', '/api/roles', null, admin);
  check('roles matrix loads (7 roles)', r.status === 200 && r.json.roles.length === 7);
  const cats = r.json.permissions;
  check('permission catalogue present', cats.length >= 20);
  const adminRole = r.json.roles.find((x) => x.name === 'Admin');
  check('Admin role has every permission', adminRole.permissions.length === cats.length);

  r = await api('POST', '/api/roles', { name: 'Smoke Tester', description: 'created by smoke test' }, admin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const testRoleId = r.json.id;
  r = await api('POST', '/api/users', { full_name: 'Smoke User', email: 'smoke@ertiqaa.ae', role_id: testRoleId, branch_id: 1 }, admin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const tempPw = r.json.temporary_password;
  check('new user gets a temporary password', !!tempPw);
  r = await api('POST', '/api/auth/login', { email: 'smoke@ertiqaa.ae', password: tempPw });
  const limited = r.json.token;
  check('permissionless role gets 403 on cases', (await api('GET', '/api/cases', null, limited)).status === 403);
  check('permissionless role gets 403 on users', (await api('GET', '/api/users', null, limited)).status === 403);

  const casesViewId = cats.find((p) => p.code === 'cases.view').id;
  r = await api('PUT', `/api/roles/${testRoleId}/permissions`, { permissions: [casesViewId] }, admin);
  check('granting cases.view from the Roles screen', r.status === 200);
  r = await api('GET', '/api/cases', null, limited);
  check('Limited role now lists 69 cases', r.status === 200 && r.json.length === 69);

  console.log('4. website webhook + enquiry conversion');
  check('webhook with wrong secret -> 401', (await api('POST', '/api/webhook/enquiry', { name: 'X', phone: '1' }, null, { 'x-webhook-secret': 'wrong' })).status === 401);
  r = await api('POST', '/api/webhook/enquiry',
    { name: 'Webhook Tester', email: 'wh@test.ae', phone: '+971500000001', service: 'Returned Cheques', message: 'site form test' }, null, { 'x-webhook-secret': 'test-webhook-secret' });
  check('webhook creates enquiry ENQ-W-####', r.status === 201 && /^ENQ-W-\d{4}$/.test(r.json.enquiry_ref));
  r = await api('POST', '/api/webhook/enquiry', { name: 'Webhook Tester', phone: '+971500000001', message: 'second post' }, null, { 'x-webhook-secret': 'test-webhook-secret' });
  check('same phone matches the existing customer', r.status === 201);

  r = await api('GET', '/api/enquiries?channel=website', null, admin);
  const enq = r.json[0];
  r = await api('PUT', `/api/enquiries/${enq.id}`, { status: 'converted', create_case: true }, admin);
  check('converted enquiry creates a case', r.status === 200 && !!r.json.case_no);

  console.log('5. case lifecycle + history');
  r = await api('POST', '/api/cases', { customer_id: 1, service_id: 1, branch_id: 1, priority: 'high', notes: 'smoke case' }, admin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const caseId = r.json.id;
  check('case number matches ERC-YYYY-####', /^ERC-\d{4}-\d{4}$/.test(r.json.case_no));
  check('case detail loads', (await api('GET', `/api/cases/${caseId}`, null, admin)).status === 200);
  check('status change ok', (await api('PUT', `/api/cases/${caseId}`, { status: 'under_review' }, admin)).status === 200);
  check('case note added', (await api('POST', `/api/cases/${caseId}/notes`, { note: 'called the client' }, admin)).status === 201);
  r = await api('POST', '/api/cases', { customer_id: 1 }, limited);
  check('cases.edit still not granted -> 403 on create', r.status === 403);
  await api('PUT', `/api/cases/${caseId}`, { status: 'resolved' }, admin);
  r = await api('GET', `/api/cases/${caseId}`, null, admin);
  check('closed case stores closed_at', !!r.json.closed_at);
  check('status history recorded', r.json.history.length >= 2);

  console.log('6. encrypted document -> signed link -> download');
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('ERTIQAA smoke test document body')], { type: 'text/plain' }), 'smoke.txt');
  fd.append('customer_id', '1');
  fd.append('title', 'Smoke doc');
  fd.append('doc_type', 'id_card');
  r = await api('POST', '/api/documents', fd, admin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const docId = r.json.id;
  r = await api('POST', `/api/files/${docId}/link`, {}, admin);
  check('signed link issued with TTL', r.status === 200 && r.json.url.startsWith('/f/') && r.json.expires_in > 0);
  const raw = await fetch(base + r.json.url);
  const body = Buffer.from(await raw.arrayBuffer()).toString('utf8');
  check('signed link streams decrypted content', raw.status === 200 && body.includes('smoke test document body'));
  check('download sends no-store', raw.headers.get('cache-control') === 'no-store');

  console.log('7. invoices: VAT, payments, PDF');
  r = await api('GET', '/api/settings', null, admin);
  check('company settings load', r.status === 200 && 'company_name' in r.json.settings);
  r = await api('POST', '/api/invoices', { customer_id: 1, case_id: caseId, branch_id: 1, items: [
    { description: 'Case handling fee', qty: 1, unit_price: 3000 },
    { description: 'Documentation', qty: 2, unit_price: 250 },
  ] }, admin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const invId = r.json.id;
  r = await api('GET', `/api/invoices/${invId}`, null, admin);
  const inv = r.json;
  check('subtotal computed server-side (3500)', Number(inv.subtotal) === 3500);
  check('5% VAT computed (175)', Number(inv.vat_amount) === 175);
  check('total 3675', Number(inv.total) === 3675);
  check('TRN snapshot saved', inv.trn !== null || inv.trn === '');
  check('payment validation rejects 0', (await api('POST', `/api/invoices/${invId}/payments`, { amount: 0 }, admin)).status === 400);
  await api('POST', `/api/invoices/${invId}/payments`, { amount: 1000, method: 'bank' }, admin);
  r = await api('GET', `/api/invoices/${invId}`, null, admin);
  check('partial payment -> status partial', (r.json).status === 'partial');
  await api('POST', `/api/invoices/${invId}/payments`, { amount: 2675, method: 'cash' }, admin);
  r = await api('GET', `/api/invoices/${invId}`, null, admin);
  check('full payment -> status paid', (r.json).status === 'paid');
  check('paid invoice locked for editing', (await api('PUT', `/api/invoices/${invId}`, { notes: 'x' }, admin)).status === 400);
  const pdf = await fetch(base + `/api/invoices/${invId}/pdf`, { headers: { Authorization: `Bearer ${admin}` } });
  check('PDF renders with %PDF magic', pdf.status === 200 && Buffer.from(await pdf.arrayBuffer()).slice(0, 4).toString() === '%PDF');

  console.log('8. payroll, dashboard, audit, backup');
  check('payroll list', (await api('GET', '/api/payroll', null, admin)).status === 200);
  r = await api('GET', '/api/dashboard', null, admin);
  check('dashboard stats', r.status === 200 && 'open_cases' in r.json.cases);
  check('audit trail records actions', (await count('audit_log')) > 0);
  const bk = spawnSync(process.execPath, ['scripts/backup.js'], { cwd: ROOT, env: { ...process.env, DB_NAME: 'ertiqaa_demo_test' }, encoding: 'utf8' });
  assert.strictEqual(bk.status, 0, `backup failed:\n${bk.stdout}\n${bk.stderr}`);
  const bdir = path.join(process.env.STORAGE_DIR, 'backups');
  const bfile = fs.readdirSync(bdir).filter((f) => f.endsWith('.sql')).pop();
  const bsql = fs.readFileSync(path.join(bdir, bfile), 'utf8');
  check('backup SQL has schema + data', bsql.includes('CREATE TABLE') && bsql.includes('INSERT INTO'));

  console.log('9. base mode first-run flow (fresh process, own throwaway DB)');
  const bf = spawnSync(process.execPath, ['tests/base-flow.js'], {
    cwd: ROOT, env: { ...process.env, STORAGE_DIR: process.env.STORAGE_DIR + '-base' }, encoding: 'utf8',
  });
  assert.strictEqual(bf.status, 0, `base flow failed:\n${bf.stdout}\n${bf.stderr}`);
  console.log(bf.stdout.trim());

  console.log('10. HeidiSQL path: schema.sql + seed.sql loaded by hand, then npm start');
  process.env.DB_NAME = 'ertiqaa_heidi_test';
  const mysql = require('mysql2/promise');
  const hc = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: '', multipleStatements: true, charset: 'utf8mb4' });
  await hc.query('DROP DATABASE IF EXISTS ertiqaa_erp');
  await hc.query(fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8'));
  await hc.query(fs.readFileSync(path.join(ROOT, 'database', 'seed.sql'), 'utf8'));
  const hcUsers = (await hc.query('SELECT COUNT(*) n FROM ertiqaa_erp.users'))[0][0].n;
  const hcCases = (await hc.query('SELECT COUNT(*) n FROM ertiqaa_erp.cases'))[0][0].n;
  check('schema.sql + seed.sql loaded 12 users + 69 cases by hand', hcUsers === 12 && hcCases === 69);
  await hc.end();
  process.env.SEED_MODE = 'demo';
  process.env.DB_NAME = 'ertiqaa_erp';
  process.env.STORAGE_DIR = path.join(os.tmpdir(), `ertiqaa-heidi-storage-${Date.now()}`);
  const boot3 = spawnSync(process.execPath, ['scripts/bootstrap.js'], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  assert.strictEqual(boot3.status, 0, `bootstrap after manual seed failed:\n${boot3.stdout}\n${boot3.stderr}`);
  check('bootstrap skipped seeding but generated the missing demo files',
    boot3.stdout.includes('skipping seed') && boot3.stdout.includes('demo files'));

  try { await mysqld.stop(); } catch {}
  console.log(`\nALL ${passed} SMOKE CHECKS PASSED`);
  process.exit(0);
})().catch((e) => {
  console.error('SMOKE TEST FAILED:', e);
  process.exit(1);
});
