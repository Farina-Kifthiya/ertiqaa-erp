/**
 * Generates seed SQL for Ertiqaa ERP.
 *
 *   node scripts/build-seed.js --base                      -> reference data + one administrator
 *   node scripts/build-seed.js                             -> full fictional demo company data
 *   node scripts/build-seed.js --out=database/seed.sql --include-use
 *
 * The bootstrap script (scripts/bootstrap.js) calls this automatically on first start
 * and loads the result into the database configured in .env.
 * Demo mode data is FICTIONAL. Never load it into a database holding real client data.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const args = process.argv.slice(2);
const outArg = (args.find((a) => a.startsWith('--out=')) || '').split('=').slice(1).join('=');
const base = args.includes('--base');
const includeUse = args.includes('--include-use');
const withSchema = args.includes('--with-schema');
const DB = 'ertiqaa_erp';

// deterministic PRNG so demo data is reproducible
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260101);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\n/g, '\\n')}'`;
};
const emit = (line) => out.push(line);
const out = [];

const today = new Date();
const year = today.getFullYear();
const daysAgo = (d) => {
  const t = new Date(today);
  t.setDate(t.getDate() - d);
  return t.toISOString().slice(0, 10);
};
const recentTime = (d, h) => `${daysAgo(d)} ${String(h).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00`;

if (!withSchema) {
  emit('SET NAMES utf8mb4;');
  emit('SET FOREIGN_KEY_CHECKS = 0;');
  if (includeUse) emit(`USE ${DB};`);
}

// ---------------- reference data ----------------

emit('-- branches');
emit("INSERT INTO branches (id, name, city, address, phone, is_head_office, active) VALUES" +
  `(1,'Head Office - Ajman','Ajman','Al Hamriyah Rd, Al Jerf Industrial 2, Ajman, UAE','+971 6 000 0000',1,1),` +
  `(2,'Dubai Branch','Dubai','Business Bay, Dubai, UAE','+971 4 000 0000',0,1),` +
  `(3,'Abu Dhabi Sample Branch','Abu Dhabi','Corniche Rd, Abu Dhabi, UAE','+971 2 000 0000',0,1);`);

emit('-- services (from ertiqaa.ae)');
emit('INSERT INTO services (id, name, name_ar, description, active) VALUES' +
  "(1,'Personal Loan','قرض شخصي','Personal financing restructuring and settlement support',1)," +
  "(2,'High DBR','نسبة الاستقطاع مرتفعة','Reduce your Debt Burden Ratio to qualify for finance',1)," +
  "(3,'Low eScore','تقييم إئتماني منخفض','Improve your AECB eScore / credit score',1)," +
  "(4,'Past Delays or Defaults','تأخيرات أو تعثرات سابقة','Clean up historical delays and defaults',1)," +
  "(5,'Returned Cheques','شيكات مرتجعة','Resolve bounced / returned cheque cases',1)," +
  "(6,'Credit Issue Review','مراجعة الملف الإئتماني','General AECB credit-case review and advisory',1)," +
  "(7,'Corporate Bank Account','حساب بنكي للشركات','Open a corporate bank account for your company',1);");

emit('-- roles (7) - Admin, Finance and Credit require 2FA');
emit('INSERT INTO roles (id, name, description, requires_2fa, is_system) VALUES' +
  "(1,'Admin','Full access to every module, including users, roles and settings',1,1)," +
  "(2,'Manager','Runs operations: cases, customers, enquiries and invoicing visibility',0,1)," +
  "(3,'Credit','Credit-case handling: reviews, negotiation and documents',1,1)," +
  "(4,'Finance','Invoicing, payments and payroll',1,1)," +
  "(5,'Sales','Enquiry intake, customers and case creation',0,1)," +
  "(6,'HR','Payroll register and user directory',0,1)," +
  "(7,'Viewer','Read-only access across the system',0,1);");

const perms = [
  ['dashboard.view', 'dashboard', 'View dashboard'],
  ['enquiries.view', 'enquiries', 'View enquiries'], ['enquiries.edit', 'enquiries', 'Create and update enquiries'],
  ['customers.view', 'customers', 'View customers'], ['customers.edit', 'customers', 'Create and update customers'],
  ['cases.view', 'cases', 'View cases'], ['cases.edit', 'cases', 'Create and update cases'],
  ['cases.assign', 'cases', 'Assign cases to staff'], ['cases.notes', 'cases', 'Add case notes'],
  ['documents.view', 'documents', 'View / download documents'], ['documents.upload', 'documents', 'Upload documents'],
  ['documents.delete', 'documents', 'Delete documents'],
  ['invoices.view', 'invoices', 'View invoices'], ['invoices.edit', 'invoices', 'Create and edit invoices'],
  ['invoices.send', 'invoices', 'Mark invoices sent'], ['invoices.pay', 'invoices', 'Record payments against invoices'],
  ['invoices.void', 'invoices', 'Void invoices'], ['payments.record', 'payments', 'Record payments'],
  ['payroll.view', 'payroll', 'View payroll register'], ['payroll.edit', 'payroll', 'Edit payroll register'],
  ['users.view', 'users', 'View users'], ['users.edit', 'users', 'Create and update users'],
  ['roles.view', 'roles', 'View roles and permissions'], ['roles.edit', 'roles', 'Change role permissions'],
  ['settings.view', 'settings', 'View settings'], ['settings.edit', 'settings', 'Change settings (branches, services, company)'],
  ['audit.view', 'audit', 'View audit log'],
];
emit('-- permissions');
emit('INSERT INTO permissions (id, code, module, label) VALUES ' +
  perms.map((p, i) => `(${i + 1},${esc(p[0])},${esc(p[1])},${esc(p[2])})`).join(',') + ';');

const rolePerms = {
  Admin: perms.map((p) => p[0]),
  Manager: ['dashboard.view','enquiries.view','enquiries.edit','customers.view','customers.edit','cases.view','cases.edit','cases.assign','cases.notes','documents.view','documents.upload','invoices.view','invoices.edit','invoices.send','payments.record','payroll.view','users.view','roles.view','settings.view','audit.view'],
  Credit: ['dashboard.view','customers.view','customers.edit','cases.view','cases.edit','cases.assign','cases.notes','documents.view','documents.upload','documents.delete','invoices.view','settings.view'],
  Finance: ['dashboard.view','customers.view','cases.view','documents.view','invoices.view','invoices.edit','invoices.send','invoices.pay','invoices.void','payments.record','payroll.view','payroll.edit','settings.view','audit.view'],
  Sales: ['dashboard.view','enquiries.view','enquiries.edit','customers.view','customers.edit','cases.view','cases.edit','cases.notes','documents.view','documents.upload','invoices.view'],
  HR: ['dashboard.view','payroll.view','payroll.edit','users.view','settings.view'],
  Viewer: ['dashboard.view','enquiries.view','customers.view','cases.view','documents.view','invoices.view','payroll.view','settings.view','audit.view'],
};
emit('-- role permissions');
const rpRows = [];
for (const [roleName, codes] of Object.entries(rolePerms)) {
  const roleId = ['Admin','Manager','Credit','Finance','Sales','HR','Viewer'].indexOf(roleName) + 1;
  for (const c of codes) rpRows.push(`(${roleId},${perms.findIndex((p) => p[0] === c) + 1})`);
}
emit('INSERT INTO role_permissions (role_id, permission_id) VALUES ' + rpRows.join(',') + ';');

emit('-- settings');
const settings = [
  ['company_name', 'Ertiqaa'],
  ['company_name_ar', 'ارتقاء'],
  ['company_address', 'Al Hamriyah Rd, Al Jerf Industrial 2, Ajman, UAE'],
  ['company_phone', '+971 6 000 0000'],
  ['company_email', 'info@ertiqaa.ae'],
  ['company_trn', base ? '' : '100200300400503'],
  ['currency', 'AED'],
  ['vat_rate', '5'],
  ['invoice_footer', 'Thank you for choosing Ertiqaa. For queries contact accounts@ertiqaa.ae.'],
].filter(([, v]) => v !== '' || true);
emit('INSERT INTO settings (skey, svalue) VALUES ' + settings.map(([k, v]) => `(${esc(k)},${esc(v)})`).join(',') + ';');

// demo customers / cases / etc are appended below in demo mode

// ---------------- users ----------------

const demoUsers = [
  ['Fatima Al Suwaidi', 'fatima.suwaidi@demo.ae', 'Admin', 1, '+971 50 111 0101'],
  ['Omar Haddad', 'omar.haddad@demo.ae', 'Manager', 1, '+971 50 111 0102'],
  ['Mona Al Ali', 'mona.ali@demo.ae', 'Manager', 2, '+971 50 111 0103'],
  ['Khalid Mansoor', 'khalid.mansoor@demo.ae', 'Credit', 1, '+971 50 111 0104'],
  ['Ruqayya Saeed', 'ruqayya.saeed@demo.ae', 'Credit', 2, '+971 50 111 0105'],
  ['Sara Ibrahim', 'sara.ibrahim@demo.ae', 'Finance', 1, '+971 50 111 0106'],
  ['Hassan Kareem', 'hassan.kareem@demo.ae', 'Finance', 2, '+971 50 111 0107'],
  ['Layla Hassan', 'layla.hassan@demo.ae', 'Sales', 1, '+971 50 111 0108'],
  ['Yusuf Rahman', 'yusuf.rahman@demo.ae', 'Sales', 2, '+971 50 111 0109'],
  ['Aisha Zayed', 'aisha.zayed@demo.ae', 'Sales', 3, '+971 50 111 0110'],
  ['Noor Al Din', 'noor.aldin@demo.ae', 'HR', 1, '+971 50 111 0111'],
  ['Tariq Bilal', 'tariq.bilal@demo.ae', 'Viewer', 3, '+971 50 111 0112'],
];

const ROLE_ID = { Admin: 1, Manager: 2, Credit: 3, Finance: 4, Sales: 5, HR: 6, Viewer: 7 };
function insertUsers(users, password, mustChange) {
  const rows = users.map((u, i) => {
    const hash = bcrypt.hashSync(password, 10);
    return `(${i + 1},${u[3]},${ROLE_ID[u[2]] || 7},${esc(u[0])},${esc(u[1])},${esc(u[4])},${esc(hash)},${mustChange ? 1 : 0})`;
  });
  emit('INSERT INTO users (id, branch_id, role_id, full_name, email, phone, password_hash, must_change_password) VALUES ' + rows.join(',') + ';');
}

if (base) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@ertiqaa.ae';
  const adminPassword = process.env.ADMIN_PASSWORD || require('../src/crypto').randomPassword();
  emit('-- administrator (change the password at first sign-in)');
  emit('INSERT INTO users (id, branch_id, role_id, full_name, email, phone, password_hash, must_change_password) VALUES ' +
    `(1,1,1,'Administrator',${esc(adminEmail)},NULL,${esc(bcrypt.hashSync(adminPassword, 10))},1);`);
  console.log(`ADMIN LOGIN  ${adminEmail}  /  ${adminPassword}   (you must change it at first sign-in)`);
} else {
  const pw = process.env.DEMO_PASSWORD || 'Ertiqaa@2026!';
  insertUsers(demoUsers, pw, 0);
  console.log(`Demo password for every seeded user: ${pw}`);

  // ---------------- demo customers ----------------
  const firstNames = ['Ahmed','Mohammed','Fatima','Sara','Omar','Layla','Yusuf','Aisha','Khalid','Noor','Rashid','Mariam','Hassan','Zayed','Amina','Tariq','Salma','Bilal','Huda','Faisal','Dana','Jassim','Reem','Salem','Noura','Abdullah','Hamdan','Moza','Saeed','Wafa'];
  const lastNames = ['Al Marzouqi','Al Hashimi','Al Suwaidi','Al Zaabi','Al Kaabi','Al Mansoori','Khan','Sheikh','Iqbal','Farouk','Haddad','Nasser','Qureshi','Al Blooshi','Al Shamsi','Hussain','Mirza','Chowdhury','Abbas','Siddiqui'];
  const cities = ['Ajman','Dubai','Sharjah','Abu Dhabi','Umm Al Quwain','RAK','Fujairah','Al Ain'];
  const nat = ['UAE','India','Pakistan','Egypt','Jordan','Philippines','Sudan','Syria','Lebanon','Bangladesh'];
  const customerCount = 64;
  const custRows = [];
  for (let i = 1; i <= customerCount; i++) {
    const fn = pick(firstNames), ln = pick(lastNames);
    custRows.push([`CU-${String(i).padStart(4, '0')}`, `${fn} ${ln}`, null, `${fn.toLowerCase()}.${ln.split(' ').pop().toLowerCase()}${i}@example.com`, `+971 5${int(0, 8)} ${int(100, 999)} ${int(1000, 9999)}`, `784-${year - 1990}-${int(1000000, 9999999)}-${int(1, 9)}`, pick(nat), pick(cities), int(1, 3), pick(['Website','WhatsApp','Call','Walk-in','Referral']), daysAgo(int(5, 200))]);
  }
  emit('-- 64 (fictional) customers');
  emit('INSERT INTO customers (id, code, full_name, name_ar, email, phone, emirates_id, nationality, city, branch_id, source, status, notes, created_by, created_at) VALUES ' +
    custRows.map((c, i) => `(${i + 1},${c.slice(0, 10).map(esc).join(',')},'active',NULL,${int(1, 8)},${esc(`${c[10]} ${int(8, 18)}:${int(10, 59)}:00`)})`).join(',') + ';');

  // ---------------- cases: 69 across all 16 statuses ----------------
  const statuses = ['new','documents_requested','documents_received','under_review','aecb_report_requested','aecb_report_received','bank_negotiation','offer_proposed','client_approval','settlement_agreed','payment_plan_active','monitoring','resolved','on_hold','rejected','withdrawn'];
  const closed = new Set(['resolved','rejected','withdrawn']);
  const svcWeights = [1,2,3,4,5,6,7];
  const caseRows = [];
  for (let i = 0; i < 69; i++) {
    const status = i < statuses.length ? statuses[i] : pick(statuses);
    const open = int(3, 210);
    caseRows.push([`ERC-${year}-${String(i + 1).padStart(4, '0')}`, int(1, 64), pick(svcWeights), int(1, 3), int(1, 8), status, pick(['low','normal','normal','normal','high']), daysAgo(open), closed.has(status) ? daysAgo(Math.max(1, open - int(5, 40))) : null, pick(['Client seeking settlement of outstanding personal loan.','Bank field investigation requested; documents pending. Returned cheque under review with bank.','DBR above 50% - restructuring plan drafted.','AECB report shows two defaults; negotiating waiver.','Corporate account: compliance documents under review.','Settlement agreed at 62% of outstanding balance.','Client disputing one late marker on AECB report.']), int(1, 8)]);
  }
  emit('-- 69 cases covering all 16 statuses');
  emit('INSERT INTO cases (id, case_no, customer_id, service_id, branch_id, assigned_to, status, priority, opened_at, closed_at, notes, created_by, created_at) VALUES ' +
    caseRows.map((c, i) => `(${i + 1},${[c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]].map(esc).join(',')},${c[8] === null ? 'NULL' : esc(c[8])},${esc(c[9])},${esc(c[10])},${esc(`${c[7]} 09:${int(10, 59)}:00`)})`).join(',') + ';');

  // history + notes
  const histRows = [];
  const noteRows = [];
  const noteTexts = ['Called client to confirm documents received.','Visited bank branch; settlement officer assigned.','Draft counter-offer shared with client for approval.','AECB report re-pulled after updates.','Follow-up scheduled for next week. Management briefed.','Awaiting client signature on settlement letter.','Payment received and forwarded to bank.'];
  caseRows.forEach((c, i) => {
    histRows.push(`(${i + 1},${i + 1},1,NULL,${esc(c[5])},${esc(`${c[7]} 09:${int(10, 59)}:00`)})`);
    const n = int(1, 3);
    for (let k = 0; k < n; k++) {
      noteRows.push(`(${i + 1},${int(1, 8)},${esc(pick(noteTexts))},${esc(recentTime(int(1, 90), int(8, 18)))})`);
    }
  });
  emit('-- case history');
  emit('INSERT INTO case_history (id, case_id, user_id, from_status, to_status, created_at) VALUES ' + histRows.join(',') + ';');
  if (noteRows.length) emit('-- case notes');
  if (noteRows.length) emit('INSERT INTO case_notes (case_id, user_id, note, created_at) VALUES ' + noteRows.join(',') + ';');

  // ---------------- enquiries ----------------
  const enqRows = [];
  const enqStatuses = ['new','contacted','qualified','converted','converted','contacted','lost'];
  for (let i = 1; i <= 90; i++) {
    const ch = pick(['website','website','website','website','whatsapp','whatsapp','whatsapp','call','call','walkin']);
    enqRows.push([`ENQ-${year}-${String(i).padStart(4, '0')}`, int(1, 64), ch, pick(svcWeights), int(1, 3), int(1, 10), pick(enqStatuses), pick(['Sent enquiry through website form.','WhatsApp conversation about loan settlement.','Inbound call, requested callback.','Walked into the Ajman office.']), recentTime(int(0, 120), int(8, 20))]);
  }
  emit('-- 90 enquiries (website enquiries logged via webhook, WhatsApp/calls logged manually)');
  emit('INSERT INTO enquiries (id, ref, customer_id, channel, service_id, branch_id, assigned_to, status, message, received_at) VALUES ' +
    enqRows.map((e, i) => `(${i + 1},${e.map(esc).join(',')})`).join(',') + ';');

  // ---------------- documents: 414 rows (files are generated by bootstrap) ----------------
  const docTypes = ['emirates_id','passport','bank_statement','salary_certificate','aecb_report','credit_report','settlement_letter','loan_agreement','returned_cheque','noc','other'];
  const titles = { emirates_id: 'Emirates ID copy', passport: 'Passport copy', bank_statement: 'Bank statement', salary_certificate: 'Salary certificate', aecb_report: 'AECB report', credit_report: 'Credit report', settlement_letter: 'Settlement letter', loan_agreement: 'Loan agreement', returned_cheque: 'Returned cheque copy', noc: 'NOC letter', other: 'Supporting document' };
  const docRows = [];
  while (docRows.length < 414) {
    const ci = int(0, 68);
    const caseRow = caseRows[ci];
    const t = pick(docTypes);
    const custCode = `CU-${String(caseRow[1]).padStart(4, '0')}`;
    const id = docRows.length + 1;
    docRows.push([id, ci + 1, caseRow[1], int(1, 8), `${titles[t]} - ${custCode}`, t, `${custCode.toLowerCase()}_${t}_${id}.pdf`, 'application/pdf', int(45, 900) * 1024, `documents/doc-${id}.bin`, `${daysAgo(int(1, 200))} ${int(8, 18)}:${int(10, 59)}:00`]);
  }
  emit('-- 414 (fictional) document records - encrypted files created by the bootstrap script');
  emit('INSERT INTO documents (id, case_id, customer_id, uploaded_by, title, doc_type, original_name, mime, size, storage_path, sha256, created_at) VALUES ' +
    docRows.map((d) => `(${d[0]},${d[1]},${d[2]},${d[3]},${esc(d[4])},${esc(d[5])},${esc(d[6])},${esc(d[7])},${d[8]},${esc(d[9])},${'0'.repeat(64)},${esc(d[10])})`).join(',') + ';');

  // ---------------- invoices ----------------
  const invStatuses = [['paid','paid','paid','paid','paid','partial','sent','sent','draft','void']];
  const vat = 5;
  const invRows = [];
  const itemPool = [
    ['AECB credit report review and action plan', 1500],
    ['Credit case handling fee', 3500],
    ['Bank negotiation and settlement support', 4500],
    ['Debt Burden Ratio restructuring advisory', 2800],
    ['Returned cheque resolution service', 2200],
    ['Corporate bank account opening support', 5000],
    ['Monthly monitoring retainer', 900],
  ];
  let invId = 0;
  for (let c = 0; c < 69; c++) {
    if (!['client_approval','payment_plan_active','monitoring','resolved','settlement_agreed'].includes(caseRows[c][5]) && rnd() > 0.25) continue;
    invId++;
    const st = pick(invStatuses[0]);
    const desc = pick(itemPool);
    const extra = rnd() < 0.4 ? pick(itemPool) : null;
    const subtotal = desc[1] + (extra ? extra[1] : 0);
    const vatAmt = +(subtotal * vat / 100).toFixed(2);
    invRows.push({ id: invId, no: `INV-${year}-${String(invId).padStart(4, '0')}`, cust: caseRows[c][1], case: c + 1, branch: caseRows[c][3], status: st, issue: daysAgo(int(5, 150)), due: daysAgo(-int(5, 30)), subtotal, vat, vatAmt, total: +(subtotal + vatAmt).toFixed(2), items: extra ? [desc, extra] : [desc] });
  }
  emit('-- invoices (AED, 5% VAT)');
  emit('INSERT INTO invoices (id, invoice_no, customer_id, case_id, branch_id, status, issue_date, due_date, subtotal, vat_rate, vat_amount, total, trn, notes, created_by, created_at) VALUES ' +
    invRows.map((v) => `(${v.id},${[v.no, v.cust, v.case, v.branch, v.status, v.issue, v.due].map(esc).join(',')},${v.subtotal},${vat.toFixed(2)},${v.vatAmt},${v.total},'100200300400503',NULL,${int(1, 8)},${esc(`${v.issue} 12:00:00`)})`).join(',') + ';');
  const itemRows = [];
  invRows.forEach((v) => v.items.forEach((it) => {
    itemRows.push(`(${v.id},${esc(it[0])},1,${it[1].toFixed(2)},${it[1].toFixed(2)})`);
  }));
  emit('INSERT INTO invoice_items (invoice_id, description, qty, unit_price, line_total) VALUES ' + itemRows.join(',') + ';');
  const payRows = [];
  invRows.filter((v) => v.status === 'paid' || v.status === 'partial').forEach((v) => {
    payRows.push(`(${v.id},${v.status === 'paid' ? v.total : (v.total / 2).toFixed(2)},${esc(pick(['bank','bank','card','cash']))},${esc(`TRF-${int(100000, 999999)}`)},${esc(`${v.issue} 12:00:00`)},${int(1, 8)})`);
  });
  if (payRows.length) emit('-- payments');
  if (payRows.length) emit('INSERT INTO payments (invoice_id, amount, method, reference, paid_at, recorded_by) VALUES ' + payRows.join(',') + ';');

  // ---------------- payroll (simple register, no WPS export) ----------------
  const payRowsP = [];
  let pr = 0;
  for (const monthsBack of [0, 1]) {
    const d = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    demoUsers.forEach((u, i) => {
      pr++;
      const basic = pick([9000, 12000, 14000, 16000, 18000, 22000, 26000, 32000]);
      const allow = int(1, 4) * 500;
      const ded = rnd() < 0.2 ? 250 : 0;
      payRowsP.push(`(${pr},${esc(period)},${u[3]},${esc(u[0])},${i + 1},${basic.toFixed(2)},${allow.toFixed(2)},${ded.toFixed(2)},${(basic + allow - ded).toFixed(2)},${monthsBack ? esc('paid') : esc('draft')},${monthsBack ? esc(`${period}-28 10:00:00`) : 'NULL'},NULL)`);
    });
  }
  emit('-- payroll register (2 periods, fictional amounts)');
  emit('INSERT INTO payroll (id, period, branch_id, employee_name, user_id, basic, allowances, deductions, net, status, paid_at, notes) VALUES ' + payRowsP.join(',') + ';');
}

emit('SET FOREIGN_KEY_CHECKS = 1;');

const header = () => `-- Ertiqaa ERP ${base ? 'base' : 'demo'} seed  (FICTIONAL DATA ONLY)  generated by scripts/build-seed.js\n`;
const prefix = withSchema
  ? fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8') + '\n'
  : '';
const sql = prefix + out.join('\n') + '\n';
if (outArg) {
  fs.mkdirSync(path.dirname(path.resolve(outArg)), { recursive: true });
  fs.writeFileSync(outArg, header() + sql);
  console.log(`written: ${outArg} (${(sql.length / 1024).toFixed(0)} KB)`);
} else {
  process.stdout.write(header() + sql);
}
