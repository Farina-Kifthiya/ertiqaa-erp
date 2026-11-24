/* ================= Ertiqaa ERP — frontend app ================= */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const app = $('#app');

let TOKEN = sessionStorage.getItem('ertiqaa_token') || '';
let ME = null;
let PERMS = new Set();
let CACHE = { branches: null, services: null };

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => 'AED ' + Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s) => s ? String(s).slice(0, 16).replace('T', ' ') : '—';

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, { ...opts, headers, body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && !path.startsWith('/auth/login')) { logout(); throw new Error('Please sign in again'); }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toast-zone').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function modal(html, { wide } = {}) {
  closeModal();
  $('#modal-zone').innerHTML = `<div class="overlay"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
  $('.overlay').addEventListener('click', (e) => { if (e.target.classList.contains('overlay')) closeModal(); });
  return $('.modal');
}
function closeModal() { $('#modal-zone').innerHTML = ''; }

const CASE_STATUSES = ['new','documents_requested','documents_received','under_review','aecb_report_requested',
  'aecb_report_received','bank_negotiation','offer_proposed','client_approval','settlement_agreed',
  'payment_plan_active','monitoring','resolved','on_hold','rejected','withdrawn'];
const STATUS_LABEL = {
  new: 'New', documents_requested: 'Documents requested', documents_received: 'Documents received',
  under_review: 'Under review', aecb_report_requested: 'AECB report requested', aecb_report_received: 'AECB report received',
  bank_negotiation: 'Bank negotiation', offer_proposed: 'Offer proposed', client_approval: 'Client approval',
  settlement_agreed: 'Settlement agreed', payment_plan_active: 'Payment plan active', monitoring: 'Monitoring',
  resolved: 'Resolved', on_hold: 'On hold', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
const CLOSED = new Set(['resolved', 'rejected', 'withdrawn']);
const statusBadge = (s) => `<span class="badge ${CLOSED.has(s) ? 'green' : s === 'on_hold' ? 'red' : 'dark'}">${esc(STATUS_LABEL[s] || s)}</span>`;
const CAN = (code) => PERMS.has(code);

async function refs(force) {
  if (!CACHE.branches || force) {
    const [b, s] = await Promise.all([api('/settings/branches'), api('/settings/services')]);
    CACHE.branches = b; CACHE.services = s;
  }
  return CACHE;
}
const branchOpts = (sel) => '<option value="">- branch -</option>' + (CACHE.branches || []).map((b) => `<option value="${b.id}" ${b.id == sel ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
const serviceOpts = (sel) => '<option value="">- service -</option>' + (CACHE.services || []).map((s) => `<option value="${s.id}" ${s.id == sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
const emptyState = (icon, text) => `<div class="empty"><div class="big">${icon}</div>${text}</div>`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ================= auth views ================= */
function loginView({ notice } = {}) {
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-brand">
      <div><div class="wordmark">ERTIQAA</div><div class="wordmark-ar">ارتقاء</div></div>
      <ul>
        <li>AECB credit-case resolution, end to end</li>
        <li>Enquiries from the website, WhatsApp and calls in one place</li>
        <li>Secure document vault with expiring links</li>
        <li>AED invoicing with 5% VAT and payroll register</li>
      </ul>
      <div class="small" style="color:#8d8471">Ertiqaa ERP · local edition</div>
    </div>
    <div class="auth-panel"><form class="auth-card" id="login-form">
      <h1>Sign in</h1>
      <div class="sub">Use the account your administrator created for you.</div>
      ${notice ? `<div class="badge gold" style="display:block;padding:9px 12px;margin-bottom:14px">${esc(notice)}</div>` : ''}
      <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="username"></div>
      <div class="field"><label>Password</label><input type="password" name="password" required autocomplete="current-password"></div>
      <button class="btn primary" style="width:100%;justify-content:center" type="submit" id="btn-login">Sign in</button>
      <div id="twofa-zone"></div>
    </form></div>
  </div>`;

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('#btn-login'); btn.disabled = true;
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value, token: f.dataset.token || undefined, otp: f.otp2 ? f.otp2.value : undefined } });
      if (r.need2fa) {
        f.dataset.token = r.tempToken;
        $('#twofa-zone').innerHTML = `
          <div style="margin-top:18px">
            ${r.need2fa_setup ? `
              <h2>Set up two-factor authentication</h2>
              <p class="muted">Your role requires 2FA. Add this key to Google/Microsoft Authenticator (choose "enter a setup key"):</p>
              <div class="secret-box">${esc(r.secret)}</div>
              <a class="otpauth-link" href="${esc(r.otpauth)}">Open in authenticator app (otpauth link)</a>` :
              '<p class="muted">Enter the 6-digit code from your authenticator app:</p>'}
            <div class="field"><label>6-digit code</label><input type="text" name="otp2" inputmode="numeric" maxlength="6" required autofocus></div>
            <button class="btn primary" style="width:100%;justify-content:center" type="submit">Verify & sign in</button>
          </div>`;
        if (r.need2fa_setup) f.password.value = '';
        return;
      }
      finishLogin(r);
    } catch (err) {
      toast(err.message, true);
      delete f.dataset.token;
      const z = $('#twofa-zone'); if (z) z.innerHTML = '';
    } finally { btn.disabled = false; }
  });
}

function finishLogin(r) {
  if (r.mustChangePassword) {
    TOKEN = r.changeToken;
    changePasswordView(r.user);
    return;
  }
  TOKEN = r.token;
  sessionStorage.setItem('ertiqaa_token', TOKEN);
  boot();
}

function changePasswordView(user) {
  app.innerHTML = `
  <div class="auth-panel" style="min-height:100vh">
    <form class="auth-card" id="cp-form">
      <h1>Welcome, ${esc(user.full_name || '')}</h1>
      <div class="sub">For security you must set your own password before continuing.</div>
      <div class="field"><label>New password (10+ chars, upper + lower + number)</label><input type="password" name="p1" required minlength="10"></div>
      <div class="field"><label>Repeat new password</label><input type="password" name="p2" required></div>
      <button class="btn primary" style="width:100%;justify-content:center">Save & continue</button>
    </form>
  </div>`;
  $('#cp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.p1.value !== f.p2.value) return toast('Passwords do not match', true);
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ newPassword: f.p1.value }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      TOKEN = ''; ME = null; PERMS = new Set();
      loginView({ notice: 'Password saved. Sign in with your new password to continue setup.' });
    } catch (err) { toast(err.message, true); }
  });
}

function logout() {
  TOKEN = ''; ME = null; PERMS = new Set();
  sessionStorage.removeItem('ertiqaa_token');
  loginView();
}

/* ================= shell ================= */
const NAV = [
  ['dashboard', 'Board', '#/', '▦'],
  ['enquiries.view', 'Enquiries', '#/enquiries', '✉'],
  ['customers.view', 'Customers', '#/customers', '☺'],
  ['cases.view', 'Cases', '#/cases', '▣'],
  ['documents.view', 'Documents', '#/documents', '🗏'],
  ['invoices.view', 'Invoices', '#/invoices', '₳'],
  ['payroll.view', 'Payroll', '#/payroll', '⛏'],
  ['users.view', 'Users & Security', '#/security', '⚿'],
  ['settings.view', 'Settings', '#/settings', '⚙'],
];

function shell(content) {
  const visible = NAV.filter(([perm]) => perm === 'dashboard' || CAN(perm));
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="wordmark"><img src="assets/logo.svg" alt=""> <span>ERTIQAA</span></div>
      <nav>${visible.map(([perm, label, href, ico]) =>
        `<a class="nav-item ${location.hash === href || (href !== '#/' && location.hash.startsWith(href)) ? 'active' : ''}" href="${href}"><span class="ico">${ico}</span><span class="lbl">${label}</span></a>`).join('')}
      </nav>
      <div class="user-chip">
        <div class="avatar">${esc((ME.full_name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join(''))}</div>
        <div class="meta"><div class="name">${esc(ME.full_name)}</div><div class="role">${esc(ME.role_name)}</div></div>
        <button class="btn ghost" style="margin-left:auto;color:#b9b09c;padding:4px 8px" id="btn-account" title="Account & security">⚙</button>
      </div>
    </aside>
    <main class="main" id="main">${content || '<div class="center-page"><span class="spin"></span></div>'}</main>
  </div>`;
  $('#btn-account').addEventListener('click', accountModal);
}

function accountModal() {
  modal(`<h2>Account & security</h2>
    <div class="kv" style="margin-bottom:18px">
      <dt>Signed in as</dt><dd>${esc(ME.full_name)} (${esc(ME.email)})</dd>
      <dt>Role</dt><dd>${esc(ME.role_name)}</dd>
      <dt>Two-factor</dt><dd>${ME.twofa_enabled ? '<span class="badge green">Enabled</span>' : ME.requires_2fa ? '<span class="badge red">Required — set up below</span>' : '<span class="badge">Optional</span>'}</dd>
    </div>
    ${ME.twofa_enabled ? '<button class="btn danger" id="btn-dis2fa">Disable 2FA</button>' : '<button class="btn primary" id="btn-setup2fa">Enable 2FA</button>'}
    <div class="foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
  const s2 = $('#btn-setup2fa'), d2 = $('#btn-dis2fa');
  if (s2) s2.addEventListener('click', setup2faFlow);
  if (d2) d2.addEventListener('click', async () => {
    const pw = prompt('Enter your password to disable 2FA:');
    if (!pw) return;
    try { await api('/auth/disable-2fa', { method: 'POST', body: { password: pw } }); toast('2FA disabled'); boot(); }
    catch (e) { toast(e.message, true); }
  });
}

async function setup2faFlow() {
  const r = await api('/auth/setup-2fa', { method: 'POST' });
  const m = modal(`<h2>Enable two-factor authentication</h2>
    <p class="muted">Add this key to your authenticator app (choose "enter a setup key"):</p>
    <div class="secret-box">${esc(r.secret)}</div>
    <a class="otpauth-link" href="${esc(r.otpauth)}">Open in authenticator (otpauth link)</a>
    <div class="field"><label>Enter the 6-digit code to confirm</label><input type="text" id="v2code" maxlength="6" inputmode="numeric"></div>
    <div class="foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="v2ok">Confirm</button></div>`);
  $('#v2ok', m).addEventListener('click', async () => {
    try {
      await api('/auth/confirm-2fa', { method: 'POST', body: { token: $('#v2code', m).value } });
      toast('2FA is now enabled for your account');
      boot();
    } catch (e) { toast(e.message, true); }
  });
}

/* ================= dashboard ================= */
async function viewDashboard() {
  const d = await api('/dashboard');
  const months = d.monthRows || [];
  const max = Math.max(1, ...months.map((m) => Number(m.total)));
  shell(`
    <div class="topbar"><h1>Dashboard</h1><div class="muted">${new Date().toLocaleDateString('en-AE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div></div>
    <div class="grid cols-4">
      <div class="card stat"><div class="k">Open cases</div><div class="v gold">${d.cases.open_cases ?? 0}</div><div class="muted small">${d.cases.high_priority ?? 0} high priority</div></div>
      <div class="card stat"><div class="k">New enquiries</div><div class="v">${d.enquiriesNew.n}</div><div class="muted small">awaiting first contact</div></div>
      <div class="card stat"><div class="k">Active customers</div><div class="v">${d.customersCount.n}</div></div>
      <div class="card stat"><div class="k">Collected this month</div><div class="v gold">${money(d.revenue.collected)}</div><div class="muted small">${money(d.revenue.invoiced)} invoiced</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h2>Collections — last 6 months</h2>
        ${months.length ? `<div class="bars" style="margin-bottom:26px">${months.map((m) => `<div class="bar" style="height:${(Number(m.total) / max * 100).toFixed(1)}%" title="${esc(m.ym)}: ${money(m.total)}"><span>${esc(m.ym.slice(5))}</span></div>`).join('')}</div>` : emptyState('', 'No payments recorded yet')}
      </div>
      <div class="card"><h2>Cases by status</h2>
        <div class="status-flow">${(d.byStatus || []).map((r) => `<span class="sq"><b>${r.n}</b> ${esc(STATUS_LABEL[r.status] || r.status)}</span>`).join('')}</div>
      </div>
    </div>
    <div class="card"><h2>Recent activity</h2>
      ${d.recent.length ? `<table class="tbl"><tbody>${d.recent.map((a) => `<tr><td style="width:170px" class="muted small">${dt(a.created_at)}</td><td style="width:150px">${esc(a.user_name || 'system')}</td><td>${esc(a.action)} ${esc(a.entity || '')} ${esc(a.entity_id || '')}</td></tr>`).join('')}</tbody></table>` : emptyState('', 'Nothing yet')}
    </div>`);
}

/* ================= enquiries ================= */
let enqFilter = { status: '', channel: '' };
async function viewEnquiries() {
  const p = new URLSearchParams();
  if (enqFilter.status) p.set('status', enqFilter.status);
  if (enqFilter.channel) p.set('channel', enqFilter.channel);
  const [rows] = await Promise.all([api('/enquiries?' + p), refs()]);
  const chip = (k, v, label) => `<span class="chip ${(enqFilter[k] === v) ? 'on' : ''}" data-k="${k}" data-v="${esc(v)}">${label}</span>`;
  shell(`
    <div class="topbar"><h1>Enquiries</h1>${CAN('enquiries.edit') ? '<button class="btn primary" id="btn-add">+ Log enquiry</button>' : ''}</div>
    <div class="toolbar"><div class="filters">
      ${chip('status', '', 'All')} ${chip('status', 'new', 'New')} ${chip('status', 'contacted', 'Contacted')} ${chip('status', 'qualified', 'Qualified')} ${chip('status', 'converted', 'Converted')} ${chip('status', 'lost', 'Lost')}
    </div><div class="filters">
      ${chip('channel', '', 'Any channel')} ${chip('channel', 'website', 'Website')} ${chip('channel', 'whatsapp', 'WhatsApp')} ${chip('channel', 'call', 'Calls')} ${chip('channel', 'walkin', 'Walk-in')}
    </div></div>
    <div class="card">
    ${rows.length ? `<table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>Channel</th><th>Service</th><th>Status</th><th>Assigned</th><th>Received</th><th class="actions">Action</th></tr></thead><tbody>
      ${rows.map((e) => `<tr><td class="muted small">${esc(e.ref)}</td>
        <td><b>${esc(e.customer_name)}</b><div class="muted small">${esc(e.customer_phone)}</div></td>
        <td><span class="badge ${e.channel === 'website' ? 'blue' : e.channel === 'whatsapp' ? 'gold' : ''}">${esc(e.channel)}</span></td>
        <td>${esc(e.service_name || '—')}</td>
        <td><span class="badge ${e.status === 'new' ? 'gold' : e.status === 'converted' ? 'green' : e.status === 'lost' ? 'red' : ''}">${esc(e.status)}</span></td>
        <td>${esc(e.assigned_name || '—')}</td>
        <td class="muted small">${dt(e.received_at)}</td>
        <td class="actions">${CAN('enquiries.edit') ? `<select data-act="enq-status" data-id="${e.id}" style="padding:5px;border-radius:7px;border:1px solid var(--line)">
          ${['new','contacted','qualified','converted','lost'].map((s) => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          ${e.status !== 'converted' ? `<button class="btn" style="margin-left:6px" data-act="enq-convert" data-id="${e.id}" title="Create a case">→ Case</button>` : ''}` : '—'}</td></tr>`).join('')}
    </tbody></table>` : emptyState('✉', 'No enquiries match')}
    </div>`);

  $$('.filters .chip').forEach((c) => c.addEventListener('click', () => {
    const v = c.dataset.v;
    if (c.dataset.k === 'status') enqFilter.status = v; else enqFilter.channel = v;
    viewEnquiries();
  }));
  $$('[data-act="enq-status"]').forEach((sel) => sel.addEventListener('change', async () => {
    const body = { status: sel.value };
    if (sel.value === 'converted') body.create_case = confirm('Also create a case for this enquiry? (OK = yes, Cancel = no)');
    try { const r = await api('/enquiries/' + sel.dataset.id, { method: 'PUT', body }); toast(r.case_no ? 'Case ' + r.case_no + ' created' : 'Enquiry updated'); viewEnquiries(); }
    catch (e) { toast(e.message, true); }
  }));
  $$('[data-act="enq-convert"]').forEach((b) => b.addEventListener('click', async () => {
    try { const r = await api('/enquiries/' + b.dataset.id, { method: 'PUT', body: { status: 'converted', create_case: true } }); toast('Case ' + r.case_no + ' created'); viewEnquiries(); }
    catch (e) { toast(e.message, true); }
  }));
  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => enquiryModal());
}

async function enquiryModal() {
  const m = modal(`<h2>Log an enquiry</h2><form id="enq-form">
    <div class="field"><label>Customer</label><select name="customer_id" required><option value="">Loading…</option></select></div>
    <div class="field-row">
      <div class="field"><label>Channel</label><select name="channel"><option value="whatsapp">WhatsApp</option><option value="call">Phone call</option><option value="walkin">Walk-in</option><option value="other">Other</option></select></div>
      <div class="field"><label>Service</label><select name="service_id">${serviceOpts()}</select></div>
    </div>
    <div class="field"><label>Notes / message</label><textarea name="message" rows="3"></textarea></div>
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Save enquiry</button></div>
  </form>`, { wide: true });
  const customers = await api('/customers');
  $('select[name=customer_id]', m).innerHTML = customers.map((c) => `<option value="${c.id}">${esc(c.full_name)} (${esc(c.code)})</option>`).join('');
  $('#enq-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/enquiries', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Enquiry logged'); viewEnquiries(); }
    catch (err) { toast(err.message, true); }
  });
}

/* ================= customers ================= */
let custQ = '';
async function viewCustomers() {
  await refs();
  const rows = await api('/customers?q=' + encodeURIComponent(custQ));
  shell(`
    <div class="topbar"><h1>Customers</h1>${CAN('customers.edit') ? '<button class="btn primary" id="btn-add">+ New customer</button>' : ''}</div>
    <div class="toolbar"><div class="search"><input id="cust-q" placeholder="Search name, code, phone…" value="${esc(custQ)}"></div><div class="muted small">${rows.length} customers</div></div>
    <div class="card">
    ${rows.length ? `<table class="tbl"><thead><tr><th>Code</th><th>Name</th><th>Phone</th><th>City</th><th>Branch</th><th>Source</th><th>Since</th><th class="actions"></th></tr></thead><tbody>
      ${rows.map((c) => `<tr><td class="muted">${esc(c.code)}</td><td><b>${esc(c.full_name)}</b>${c.name_ar ? `<div class="muted small" dir="rtl">${esc(c.name_ar)}</div>` : ''}</td>
        <td>${esc(c.phone)}</td><td>${esc(c.city || '—')}</td><td>${esc(c.branch_name || '—')}</td><td>${esc(c.source || '—')}</td>
        <td class="muted small">${dt(c.created_at)}</td>
        <td class="actions">${CAN('customers.edit') ? `<button class="btn" data-edit="${c.id}">Edit</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyState('☺', 'No customers found')}
    </div>`);
  $('#cust-q').addEventListener('input', debounce(() => { custQ = $('#cust-q').value; viewCustomers(); }, 350));
  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => customerModal());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const c = await api('/customers/' + b.dataset.edit);
    customerModal(c);
  }));
}

async function customerModal(c) {
  await refs();
  const m = modal(`<h2>${c ? 'Edit customer' : 'New customer'}</h2><form id="cust-form">
    <div class="field-row">
      <div class="field"><label>Full name *</label><input name="full_name" required value="${esc(c && c.full_name)}"></div>
      <div class="field"><label>Name (Arabic)</label><input name="name_ar" value="${esc(c && c.name_ar)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Phone * (e.g. +971 50 123 4567)</label><input name="phone" required value="${esc(c && c.phone)}"></div>
      <div class="field"><label>Email</label><input type="email" name="email" value="${esc(c && c.email)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Emirates ID</label><input name="emirates_id" value="${esc(c && c.emirates_id)}"></div>
      <div class="field"><label>Nationality</label><input name="nationality" value="${esc(c && c.nationality)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>City</label><input name="city" value="${esc(c && c.city)}"></div>
      <div class="field"><label>Branch</label><select name="branch_id">${branchOpts(c && c.branch_id)}</select></div>
    </div>
    <div class="field"><label>Source</label><select name="source">${['', 'Website', 'WhatsApp', 'Call', 'Walk-in', 'Referral'].map((s) => `<option ${(c && c.source) === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>Notes</label><textarea name="notes" rows="2">${esc(c && c.notes)}</textarea></div>
    ${c ? `<label style="font-size:13px"><input type="checkbox" name="archived" ${c.status === 'archived' ? 'checked' : ''}> Archived (hidden from lists)</label>` : ''}
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Save customer</button></div>
  </form>`, { wide: true });
  $('#cust-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.status = body.archived === 'on' ? 'archived' : 'active';
    delete body.archived;
    try {
      c ? await api('/customers/' + c.id, { method: 'PUT', body }) : await api('/customers', { method: 'POST', body });
      closeModal(); toast('Customer saved'); viewCustomers();
    } catch (err) { toast(err.message, true); }
  });
}

/* ================= cases ================= */
let caseFilter = { q: '', status: '' };
async function viewCases() {
  const p = new URLSearchParams();
  if (caseFilter.q) p.set('q', caseFilter.q);
  if (caseFilter.status) p.set('status', caseFilter.status);
  const [rows, users] = await Promise.all([api('/cases?' + p), CAN('cases.assign') ? api('/users') : Promise.resolve([])]);
  shell(`
    <div class="topbar"><h1>Cases</h1>${CAN('cases.edit') ? '<button class="btn primary" id="btn-add">+ New case</button>' : ''}</div>
    <div class="toolbar"><div class="search"><input id="case-q" placeholder="Search case no, customer, phone…" value="${esc(caseFilter.q)}"></div>
      <div class="filters"><span class="chip ${!caseFilter.status ? 'on' : ''}" data-v="">All</span>
      ${CASE_STATUSES.map((s) => `<span class="chip ${caseFilter.status === s ? 'on' : ''}" data-v="${s}">${STATUS_LABEL[s]}</span>`).join('')}</div></div>
    <div class="card">
    ${rows.length ? `<table class="tbl"><thead><tr><th>Case</th><th>Customer</th><th>Service</th><th>Branch</th><th>Assigned</th><th>Status</th><th>Priority</th><th>Opened</th></tr></thead><tbody>
      ${rows.map((c) => `<tr style="cursor:pointer" data-open="${c.id}">
        <td><b>${esc(c.case_no)}</b></td><td>${esc(c.customer_name)}<div class="muted small">${esc(c.customer_phone)}</div></td>
        <td>${esc(c.service_name || '—')}</td><td>${esc(c.branch_name || '—')}</td><td>${esc(c.assigned_name || '—')}</td>
        <td>${statusBadge(c.status)}</td>
        <td><span class="badge ${c.priority === 'high' ? 'red' : c.priority === 'low' ? '' : 'gold'}">${esc(c.priority)}</span></td>
        <td class="muted small">${esc(c.opened_at || '')}</td></tr>`).join('')}
    </tbody></table>` : emptyState('▣', 'No cases match')}
    </div>`);
  $('#case-q').addEventListener('input', debounce(() => { caseFilter.q = $('#case-q').value; viewCases(); }, 350));
  $$('.filters .chip').forEach((c) => c.addEventListener('click', () => { caseFilter.status = c.dataset.v; viewCases(); }));
  $$('[data-open]').forEach((tr) => tr.addEventListener('click', () => { location.hash = '#/case/' + tr.dataset.open; }));
  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => caseModal(users));
}

async function caseModal(users) {
  await refs();
  const customers = await api('/customers');
  const m = modal(`<h2>New case</h2><form id="case-form">
    <div class="field"><label>Customer *</label><select name="customer_id" required>${customers.map((c) => `<option value="${c.id}">${esc(c.full_name)} (${esc(c.code)})</option>`).join('')}</select></div>
    <div class="field-row">
      <div class="field"><label>Service</label><select name="service_id">${serviceOpts()}</select></div>
      <div class="field"><label>Branch</label><select name="branch_id">${branchOpts()}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Assign to</label><select name="assigned_to"><option value="">- me -</option>${users.map((u) => `<option value="${u.id}">${esc(u.full_name)}${u.role_name ? ' (' + esc(u.role_name) + ')' : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Priority</label><select name="priority"><option>normal</option><option>high</option><option>low</option></select></div>
    </div>
    <div class="field"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Create case</button></div>
  </form>`, { wide: true });
  $('#case-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target));
      if (!body.assigned_to) body.assigned_to = ME.id;
      const r = await api('/cases', { method: 'POST', body });
      closeModal(); toast('Case ' + r.case_no + ' created'); location.hash = '#/case/' + r.id;
    } catch (err) { toast(err.message, true); }
  });
}

async function viewCase(id) {
  const [c, users] = await Promise.all([api('/cases/' + id), refs().then(() => api('/users'))]);
  shell(`
    <div class="topbar"><div><a href="#/cases">← All cases</a><h1 style="margin-top:6px">${esc(c.case_no)}</h1><div class="muted">${esc(c.customer_name)} · ${esc(c.service_name || 'no service')} · opened ${esc(c.opened_at || '')}</div></div>
    <div>${statusBadge(c.status)} <span class="badge ${c.priority === 'high' ? 'red' : 'gold'}">${esc(c.priority)}</span></div></div>
    <div class="grid cols-2">
      <div>
        <div class="card"><h2>Case details</h2>
          <div class="toolbar" style="margin:10px 0 4px">
            <select id="c-status">${CASE_STATUSES.map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
            <select id="c-priority"><option value="normal" ${c.priority === 'normal' ? 'selected' : ''}>normal</option><option value="high" ${c.priority === 'high' ? 'selected' : ''}>high</option><option value="low" ${c.priority === 'low' ? 'selected' : ''}>low</option></select>
            <select id="c-assign"><option value="">${esc(c.assigned_name || '- unassigned -')}</option>${users.map((u) => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select>
            ${CAN('cases.edit') ? '<button class="btn primary" id="c-save">Save</button>' : ''}
          </div>
          <div class="kv" style="margin-top:10px">
            <dt>Customer</dt><dd>${esc(c.customer_name)} (${esc(c.customer_code)}) · ${esc(c.customer_phone || '')}</dd>
            <dt>Branch</dt><dd>${esc(c.branch_name || '—')}</dd>
            <dt>Closed</dt><dd>${esc((c.closed_at || '').slice(0, 10) || '—')}</dd>
            <dt>Notes</dt><dd>${esc(c.notes || '—')}</dd>
          </div>
        </div>
        <div class="card"><h2>Documents (${c.documents.length})</h2>
          ${CAN('documents.upload') ? `<div class="filebox" id="c-upload" style="margin-bottom:12px">Click to upload a document for this case<input type="file" id="c-file" hidden></div>` : ''}
          ${c.documents.length ? `<table class="tbl"><tbody>${c.documents.map((d) => `<tr><td><b>${esc(d.title)}</b><div class="muted small">${esc(d.original_name)} · ${(d.size / 1024).toFixed(0)} KB</div></td>
            <td class="muted small" style="width:130px">${dt(d.created_at)}</td>
            <td class="actions" style="width:90px"><button class="btn" data-link="${d.id}">Open ↗</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No documents on this case yet</div>'}
        </div>
        <div class="card"><h2>History</h2>
          ${c.history.length ? `<table class="tbl"><tbody>${c.history.map((h) => `<tr><td class="muted small" style="width:170px">${dt(h.created_at)}</td><td>${h.actor ? esc(h.actor) + ': ' : ''}${h.from_status ? esc(STATUS_LABEL[h.from_status] || h.from_status) + ' → ' : ''}${esc(STATUS_LABEL[h.to_status] || h.to_status || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">—</div>'}
        </div>
      </div>
      <div class="card" style="align-self:start"><h2>Notes</h2>
        ${CAN('cases.notes') ? `<form id="note-form"><div class="field"><textarea name="note" rows="2" placeholder="Add a note…"></textarea></div><button class="btn primary">Add note</button></form>` : ''}
        <div id="notes-list" style="margin-top:14px">
        ${c.notes.length ? c.notes.map((n) => `<div class="card" style="margin-bottom:10px;padding:12px 14px"><b class="small">${esc(n.author || 'system')}</b> <span class="muted small">${dt(n.created_at)}</span><p style="margin:6px 0 0">${esc(n.note)}</p></div>`).join('') : '<div class="empty">No notes yet</div>'}
        </div>
      </div>
    </div>`);

  const save = $('#c-save');
  if (save) save.addEventListener('click', async () => {
    try {
      const sel = $('#c-assign');
      await api('/cases/' + id, { method: 'PUT', body: { status: $('#c-status').value, priority: $('#c-priority').value, assigned_to: sel.value ? Number(sel.value) : null } });
      toast('Case updated'); viewCase(id);
    } catch (e) { toast(e.message, true); }
  });
  const nf = $('#note-form');
  if (nf) nf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/cases/' + id + '/notes', { method: 'POST', body: { note: nf.note.value } }); toast('Note added'); viewCase(id); }
    catch (e2) { toast(e2.message, true); }
  });
  $$('[data-link]').forEach((b) => b.addEventListener('click', () => openDocument(b.dataset.link)));
  const up = $('#c-upload');
  if (up) up.addEventListener('click', () => $('#c-file').click());
  const file = $('#c-file');
  if (file) file.addEventListener('change', () => uploadDocument({ customer_id: c.customer_id, case_id: c.id }, file.files[0]));
}

/* ================= documents ================= */
let docQ = '', docType = '';
async function viewDocuments() {
  const p = new URLSearchParams();
  if (docQ) p.set('q', docQ);
  if (docType) p.set('doc_type', docType);
  const rows = await api('/documents?' + p);
  const types = ['emirates_id','passport','bank_statement','salary_certificate','aecb_report','credit_report','settlement_letter','loan_agreement','returned_cheque','noc','other'];
  shell(`
    <div class="topbar"><h1>Document vault</h1>${CAN('documents.upload') ? '<button class="btn primary" id="btn-upload">+ Upload</button>' : ''}</div>
    <div class="toolbar"><div class="search"><input id="doc-q" placeholder="Search title or file name…" value="${esc(docQ)}"></div>
      <div class="filters"><span class="chip ${!docType ? 'on' : ''}" data-v="">All types</span>${types.map((t) => `<span class="chip ${docType === t ? 'on' : ''}" data-v="${t}">${t.replace(/_/g, ' ')}</span>`).join('')}</div></div>
    <div class="card">
    ${rows.length ? `<table class="tbl"><thead><tr><th>Title</th><th>Customer</th><th>Case</th><th>Type</th><th>Size</th><th>Uploaded</th><th class="actions"></th></tr></thead><tbody>
      ${rows.map((d) => `<tr><td><b>${esc(d.title)}</b><div class="muted small" style="font-family:monospace">${esc(d.original_name)}</div></td>
        <td>${esc(d.customer_name)}<div class="muted small">${esc(d.customer_code)}</div></td>
        <td class="muted">${esc(d.case_no || '—')}</td>
        <td><span class="badge">${esc(d.doc_type.replace(/_/g, ' '))}</span></td>
        <td class="muted small">${(d.size / 1024).toFixed(0)} KB</td><td class="muted small">${dt(d.created_at)}</td>
        <td class="actions"><button class="btn" data-link="${d.id}">Open ↗</button>
        ${CAN('documents.delete') ? `<button class="btn danger" data-del="${d.id}">✕</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyState('cntl', 'No documents found. Files are encrypted at rest with your ENCRYPTION_KEY.')}
    </div>`);
  $('#doc-q').addEventListener('input', debounce(() => { docQ = $('#doc-q').value; viewDocuments(); }, 350));
  $$('.filters .chip').forEach((c) => c.addEventListener('click', () => { docType = c.dataset.v; viewDocuments(); }));
  $$('[data-link]').forEach((b) => b.addEventListener('click', () => openDocument(b.dataset.link)));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this document permanently?')) return;
    try { await api('/documents/' + b.dataset.del, { method: 'DELETE' }); toast('Document deleted'); viewDocuments(); }
    catch (e) { toast(e.message, true); }
  }));
  const up = $('#btn-upload');
  if (up) up.addEventListener('click', () => uploadModal());
}

async function uploadModal() {
  await refs();
  const customers = await api('/customers');
  const m = modal(`<h2>Upload document</h2><form id="up-form">
    <div class="field"><label>Customer *</label><select name="customer_id" required><option value="">Choose…</option>${customers.map((c) => `<option value="${c.id}">${esc(c.full_name)} (${esc(c.code)})</option>`).join('')}</select></div>
    <div class="field-row">
      <div class="field"><label>Document type</label><select name="doc_type">${['other','emirates_id','passport','bank_statement','salary_certificate','aecb_report','credit_report','settlement_letter','loan_agreement','returned_cheque','noc'].map((t) => `<option>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Title</label><input name="title" placeholder="e.g. Emirates ID copy"></div>
    </div>
    <div class="filebox" id="pick">Choose a file (max 25 MB)<input type="file" name="file" id="f-in" required hidden></div>
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Upload</button></div>
  </form>`, { wide: true });
  const pi = $('#pick', m);
  pi.addEventListener('click', () => $('#f-in', m).click());
  $('#f-in', m).addEventListener('change', () => { pi.firstChild.textContent = $('#f-in', m).files[0] ? 'Selected: ' + $('#f-in', m).files[0].name : 'Choose a file (max 25 MB)'; });
  $('#up-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData();
    fd.set('customer_id', f.customer_id.value); fd.set('doc_type', f.doc_type.value); fd.set('title', f.title.value);
    fd.set('file', f.file.files[0]);
    try { await api('/documents', { method: 'POST', body: fd }); closeModal(); toast('Document uploaded and encrypted'); viewDocuments(); }
    catch (err) { toast(err.message, true); }
  });
}

async function uploadDocument(meta, file) {
  if (!file) return;
  const fd = new FormData();
  for (const [k, v] of Object.entries(meta)) fd.set(k, v);
  fd.set('file', file);
  try { await api('/documents', { method: 'POST', body: fd }); toast('Document uploaded and encrypted'); }
  catch (e) { toast(e.message, true); }
}

async function openDocument(id) {
  try {
    const r = await api('/documents/' + id + '/link', { method: 'POST' });
    window.open(r.url, '_blank');
    toast('Secure link created — expires in ' + Math.round(r.expires_in / 60) + ' min');
  } catch (e) { toast(e.message, true); }
}

/* ================= invoices ================= */
let invQ = '', invStatus = '';
async function viewInvoices() {
  const p = new URLSearchParams();
  if (invQ) p.set('q', invQ);
  if (invStatus) p.set('status', invStatus);
  const rows = await api('/invoices?' + p);
  shell(`
    <div class="topbar"><h1>Invoices</h1>${CAN('invoices.edit') ? '<button class="btn primary" id="btn-add">+ New invoice</button>' : ''}</div>
    <div class="toolbar"><div class="search"><input id="inv-q" placeholder="Search invoice no or customer…" value="${esc(invQ)}"></div>
      <div class="filters">${['', 'draft', 'sent', 'partial', 'paid', 'void'].map((s) => `<span class="chip ${invStatus === s ? 'on' : ''}" data-v="${s}">${s || 'All'}</span>`).join('')}</div></div>
    <div class="card">
    ${rows.length ? `<table class="tbl"><thead><tr><th>Invoice</th><th>Customer</th><th>Case</th><th>Issued</th><th>Due</th><th>Total</th><th>Status</th><th class="actions"></th></tr></thead><tbody>
      ${rows.map((i) => `<tr style="cursor:pointer" data-open="${i.id}">
        <td><b>${esc(i.invoice_no)}</b></td><td>${esc(i.customer_name)}</td><td class="muted">${esc(i.case_no || '—')}</td>
        <td class="muted small">${esc(i.issue_date || '')}</td><td class="muted small">${esc(i.due_date || '')}</td>
        <td><b>${money(i.total)}</b></td>
        <td><span class="badge ${i.status === 'paid' ? 'green' : i.status === 'void' ? 'red' : i.status === 'partial' ? 'gold' : 'blue'}">${esc(i.status)}</span></td>
        <td class="actions"><button class="btn" data-pdf="${i.id}" title="Open PDF">PDF ↓</button></td></tr>`).join('')}
    </tbody></table>` : emptyState('₳', 'No invoices yet')}
    </div>`);
  $('#inv-q').addEventListener('input', debounce(() => { invQ = $('#inv-q').value; viewInvoices(); }, 350));
  $$('.filters .chip').forEach((c) => c.addEventListener('click', () => { invStatus = c.dataset.v; viewInvoices(); }));
  $$('[data-open]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-pdf]')) return;
    location.hash = '#/invoice/' + tr.dataset.open;
  }));
  $$('[data-pdf]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openPdf(b.dataset.pdf); }));
  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => invoiceModal());
}

async function openPdf(id) {
  try {
    const res = await fetch('/api/invoices/' + id + '/pdf', { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (!res.ok) throw new Error('PDF failed (' + res.status + ')');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) { toast(e.message, true); }
}

async function invoiceModal() {
  await refs();
  const customers = await api('/customers');
  const m = modal(`<h2>New invoice</h2><form id="inv-form">
    <div class="field-row">
      <div class="field"><label>Customer *</label><select name="customer_id" required><option value="">Choose…</option>${customers.map((c) => `<option value="${c.id}">${esc(c.full_name)} (${esc(c.code)})</option>`).join('')}</select></div>
      <div class="field"><label>Case id (optional)</label><input name="case_id" type="number" min="1"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Issue date</label><input type="date" name="issue_date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label>Due date</label><input type="date" name="due_date" value="${new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)}"></div>
    </div>
    <div id="items-zone"></div>
    <button type="button" class="btn" id="btn-additem">+ Add line</button>
    <div id="inv-totals" style="margin-top:12px;text-align:right;font-weight:600"></div>
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Create invoice</button></div>
  </form>`, { wide: true });

  const zone = $('#items-zone', m);
  const updTotals = () => {
    const sub = $$('[name=price]', zone).reduce((s, i) => s + (Number(i.value) || 0), 0);
    const vat = sub * 0.05;
    $('#inv-totals', m).innerHTML = `Subtotal ${money(sub)} · VAT 5% ${money(vat)} · <span style="color:var(--gold-dark)">Total ${money(sub + vat)}</span>`;
  };
  const addLine = (desc = '', price = '') => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `<div class="field"><input name="desc" placeholder="Description" value="${esc(desc)}"></div>
      <div class="field" style="display:flex;gap:8px">
        <input name="price" type="number" step="0.01" min="0" placeholder="Amount (AED)" value="${price}">
        <button type="button" class="btn" title="Remove line" onclick="this.closest('.field-row').remove();window.updT()">✕</button>
      </div>`;
    zone.appendChild(row);
    $$('input', row).forEach((i) => i.addEventListener('input', updTotals));
  };
  window.updT = updTotals;
  $('#btn-additem', m).addEventListener('click', () => addLine());
  addLine('AECB credit report review and action plan', '');
  addLine('', '');
  updTotals();

  $('#inv-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const items = [];
    const descs = $$('[name=desc]', zone), prices = $$('[name=price]', zone);
    descs.forEach((d, i) => { if (Number(prices[i].value) > 0) items.push({ description: d.value || 'Service', qty: 1, unit_price: Number(prices[i].value) }); });
    try {
      const r = await api('/invoices', { method: 'POST', body: {
        customer_id: f.customer_id.value, case_id: f.case_id.value ? Number(f.case_id.value) : null,
        issue_date: f.issue_date.value, due_date: f.due_date.value, items,
      } });
      closeModal(); toast('Invoice ' + r.invoice_no + ' created'); location.hash = '#/invoice/' + r.id;
    } catch (err) { toast(err.message, true); }
  });
}

async function viewInvoice(id) {
  await refs();
  const i = await api('/invoices/' + id);
  const balance = Number(i.total) - Number(i.amount_paid);
  shell(`
    <div class="topbar"><div><a href="#/invoices">← All invoices</a><h1 style="margin-top:6px">${esc(i.invoice_no)}</h1>
      <div class="muted">${esc(i.customer_name)} · ${esc(i.branch_name || '')}</div></div>
      <div class="toolbar" style="margin:0">
        <span class="badge ${i.status === 'paid' ? 'green' : i.status === 'void' ? 'red' : i.status === 'partial' ? 'gold' : 'blue'}" style="font-size:13px;padding:6px 14px">${esc(i.status)}</span>
        <button class="btn" id="btn-pdf">PDF ↓</button>
        ${CAN('invoices.edit') && !['paid', 'void'].includes(i.status) ? '<button class="btn" id="btn-send">Mark sent</button>' : ''}
        ${CAN('payments.record') && !['draft', 'void'].includes(i.status) ? '<button class="btn primary" id="btn-pay">+ Payment</button>' : ''}
        ${CAN('invoices.void') && i.status !== 'void' ? '<button class="btn danger" id="btn-void">Void</button>' : ''}
      </div></div>
    <div class="grid cols-2">
      <div class="card"><h2>Invoice</h2><div class="kv">
        <dt>Customer</dt><dd>${esc(i.customer_name)} (${esc(i.customer_code)})</dd>
        <dt>Contact</dt><dd>${esc(i.customer_phone || '—')} · ${esc(i.customer_email || '—')}</dd>
        ${i.case_no ? `<dt>Case</dt><dd>${esc(i.case_no)}</dd>` : ''}
        <dt>Issued / due</dt><dd>${esc(i.issue_date || '')} → ${esc(i.due_date || '')}</dd>
        <dt>TRN</dt><dd>${esc(i.trn || '—')}</dd>
      </div>
      <table class="tbl" style="margin-top:16px"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th style="text-align:right">Total</th></tr></thead><tbody>
        ${i.items.map((it) => `<tr><td>${esc(it.description)}</td><td>${it.qty}</td><td>${money(it.unit_price)}</td><td style="text-align:right">${money(it.line_total)}</td></tr>`).join('')}
        <tr><td colspan="3" style="text-align:right" class="muted">Subtotal</td><td style="text-align:right">${money(i.subtotal)}</td></tr>
        <tr><td colspan="3" style="text-align:right" class="muted">VAT ${Number(i.vat_rate)}%</td><td style="text-align:right">${money(i.vat_amount)}</td></tr>
        <tr><td colspan="3" style="text-align:right"><b>Total</b></td><td style="text-align:right"><b style="color:var(--gold-dark);font-size:16px">${money(i.total)}</b></td></tr>
        ${Number(i.amount_paid) ? `<tr><td colspan="3" style="text-align:right" class="muted">Paid / balance</td><td style="text-align:right" class="muted">${money(i.amount_paid)} / ${money(balance)}</td></tr>` : ''}
      </tbody></table></div>
      <div class="card"><h2>Payments</h2>
        ${i.payments.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th style="text-align:right">Amount</th></tr></thead><tbody>
          ${i.payments.map((p) => `<tr><td>${dt(p.paid_at)}</td><td><span class="badge">${esc(p.method)}</span></td><td class="muted">${esc(p.reference || '—')}</td><td style="text-align:right">${money(p.amount)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No payments recorded</div>'}
      </div>
    </div>`);
  $('#btn-pdf').addEventListener('click', () => openPdf(id));
  const send = $('#btn-send');
  if (send) send.addEventListener('click', async () => {
    try { await api('/invoices/' + id, { method: 'PUT', body: { status: 'sent' } }); toast('Marked as sent'); viewInvoice(id); } catch (e) { toast(e.message, true); }
  });
  const pay = $('#btn-pay');
  if (pay) pay.addEventListener('click', () => {
    const m = modal(`<h2>Record payment — ${esc(i.invoice_no)}</h2><form id="pay-form">
      <div class="field-row">
        <div class="field"><label>Amount (AED) *</label><input name="amount" type="number" step="0.01" min="0.01" max="${balance}" value="${balance.toFixed(2)}" required></div>
        <div class="field"><label>Method</label><select name="method"><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></div>
      </div>
      <div class="field"><label>Reference</label><input name="reference" placeholder="e.g. TRF-123456"></div>
      <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Record payment</button></div></form>`);
    $('#pay-form', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/invoices/' + id + '/payments', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Payment recorded'); viewInvoice(id); }
      catch (err) { toast(err.message, true); }
    });
  });
  const voidBtn = $('#btn-void');
  if (voidBtn) voidBtn.addEventListener('click', async () => {
    if (!confirm('Void this invoice?')) return;
    try { await api('/invoices/' + id + '/void', { method: 'POST' }); toast('Invoice voided'); viewInvoice(id); } catch (e) { toast(e.message, true); }
  });
}

/* ================= payroll ================= */
let payPeriod = '';
async function viewPayroll() {
  await refs();
  const rows = await api('/payroll' + (payPeriod ? '?period=' + payPeriod : ''));
  const periods = [...new Set(rows.map((r) => r.period))].sort().reverse();
  const totals = rows.reduce((t, r) => ({ net: t.net + Number(r.net), paid: t.paid + (r.status === 'paid' ? Number(r.net) : 0) }), { net: 0, paid: 0 });
  shell(`
    <div class="topbar"><h1>Payroll register</h1>${CAN('payroll.edit') ? '<button class="btn primary" id="btn-add">+ Entry</button>' : ''}</div>
    <div class="toolbar"><div class="filters"><span class="chip ${!payPeriod ? 'on' : ''}" data-v="">All periods</span>${periods.map((p) => `<span class="chip ${payPeriod === p ? 'on' : ''}" data-v="${p}">${p}</span>`).join('')}</div>
      <div class="muted">Total net: <b>${money(totals.net)}</b> · Paid: <b>${money(totals.paid)}</b></div></div>
    <div class="card">
    ${rows.length ? `<table class="tbl"><thead><tr><th>Period</th><th>Employee</th><th>Branch</th><th>Basic</th><th>Allowances</th><th>Deductions</th><th>Net</th><th>Status</th><th class="actions"></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="muted">${esc(r.period)}</td><td><b>${esc(r.employee_name)}</b></td><td>${esc(r.branch_name || '—')}</td>
        <td>${money(r.basic)}</td><td>${money(r.allowances)}</td><td>${Number(r.deductions) ? '-' : ''}${money(r.deductions)}</td>
        <td><b>${money(r.net)}</b></td>
        <td><span class="badge ${r.status === 'paid' ? 'green' : 'gold'}">${esc(r.status)}</span></td>
        <td class="actions">${CAN('payroll.edit') ? `<button class="btn" data-edit="${r.id}">Edit</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyState('⛏', 'No payroll entries')}
    </div>
    <div class="muted small" style="margin-left:4px">Simple register — no WPS export (phase 2).</div>`);
  $$('.filters .chip').forEach((c) => c.addEventListener('click', () => { payPeriod = c.dataset.v; viewPayroll(); }));
  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => payrollModal());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => payrollModal(rows.find((r) => r.id == b.dataset.edit))));
}

async function payrollModal(r) {
  await refs();
  const m = modal(`<h2>${r ? 'Edit payroll entry' : 'New payroll entry'}</h2><form id="pay-form">
    <div class="field-row">
      <div class="field"><label>Period (YYYY-MM) *</label><input name="period" required value="${esc(r ? r.period : new Date().toISOString().slice(0, 7))}"></div>
      <div class="field"><label>Employee *</label><input name="employee_name" required value="${esc(r && r.employee_name)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Branch</label><select name="branch_id">${branchOpts(r && r.branch_id)}</select></div>
      <div class="field"><label>Status</label><select name="status"><option ${r && r.status === 'paid' ? '' : 'selected'}>draft</option><option ${r && r.status === 'paid' ? 'selected' : ''}>paid</option></select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Basic (AED)</label><input name="basic" type="number" step="0.01" value="${r ? Number(r.basic) : ''}"></div>
      <div class="field"><label>Allowances (AED)</label><input name="allowances" type="number" step="0.01" value="${r ? Number(r.allowances) : ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Deductions (AED)</label><input name="deductions" type="number" step="0.01" value="${r ? Number(r.deductions) : ''}"></div>
      <div class="field"><label>Notes</label><input name="notes" value="${esc(r && r.notes)}"></div>
    </div>
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Save</button></div>
  </form>`, { wide: true });
  $('#pay-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      r ? await api('/payroll/' + r.id, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) })
        : await api('/payroll', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      closeModal(); toast('Payroll saved'); viewPayroll();
    } catch (err) { toast(err.message, true); }
  });
}

/* ================= users & security ================= */
let secTab = 'users';
async function viewSecurity() {
  const tabs = [['users', 'Users', 'users.view'], ['roles', 'Roles & Permissions', 'roles.view'], ['audit', 'Audit log', 'audit.view']];
  shell(`
    <div class="topbar"><h1>Users & Security</h1></div>
    <div class="tabs">${tabs.filter(([, , perm]) => CAN(perm)).map(([k, label]) => `<span class="tab ${secTab === k ? 'active' : ''}" data-tab="${k}">${label}</span>`).join('')}</div>
    <div id="sec-content"><div class="center-page"><span class="spin"></span></div></div>`);
  $$('.tab').forEach((t) => t.addEventListener('click', () => { secTab = t.dataset.tab; viewSecurity(); }));
  if (secTab === 'users' && CAN('users.view')) await renderUsers();
  else if (secTab === 'roles' && CAN('roles.view')) await renderRoles();
  else if (secTab === 'audit' && CAN('audit.view')) await renderAudit();
}

async function renderUsers() {
  const [rows, rolesAvail] = await Promise.all([api('/users'), api('/roles').catch(() => ({ roles: [] }))]);
  $('#sec-content').innerHTML = `
    <div class="toolbar"><div class="muted">${rows.length} users · Admin, Finance and Credit roles require 2FA by policy</div>
    ${CAN('users.edit') ? '<button class="btn primary" id="btn-add">+ New user</button>' : ''}</div>
    <div class="card">
    <table class="tbl"><thead><tr><th>User</th><th>Role</th><th>Branch</th><th>2FA</th><th>Status</th><th>Last login</th><th class="actions"></th></tr></thead><tbody>
      ${rows.map((u) => `<tr><td><b>${esc(u.full_name)}</b><div class="muted small" style="font-family:monospace">${esc(u.email)}</div></td>
        <td><span class="badge ${['Admin', 'Finance', 'Credit'].includes(u.role_name) ? 'gold' : ''}">${esc(u.role_name)}</span></td>
        <td>${esc(u.branch_name || '—')}</td>
        <td>${u.twofa_enabled ? '<span class="badge green">on</span>' : '<span class="badge">off</span>'}${['Admin', 'Finance', 'Credit'].includes(u.role_name) ? '<div class="muted small">required</div>' : ''}</td>
        <td><span class="badge ${u.status === 'active' ? 'green' : 'red'}">${esc(u.status)}</span></td>
        <td class="muted small">${dt(u.last_login_at)}</td>
        <td class="actions">${CAN('users.edit') ? `<button class="btn" data-edit="${u.id}">Edit</button>
          <button class="btn" data-reset="${u.id}">Reset pw</button>
          ${u.id != ME.id ? `<button class="btn ${u.status === 'active' ? 'danger' : ''}" data-toggle="${u.id}" data-status="${u.status}">${u.status === 'active' ? 'Disable' : 'Enable'}</button>` : ''}` : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => userModal(rolesAvail.roles));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => userModal(rolesAvail.roles, rows.find((u) => u.id == b.dataset.edit))));
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const to = b.dataset.status === 'active' ? 'disabled' : 'active';
    if (to === 'disabled' && !confirm('Disable this account? They lose access immediately.')) return;
    try { await api('/users/' + b.dataset.toggle, { method: 'PUT', body: { status: to } }); toast('User ' + to); renderUsers(); }
    catch (e) { toast(e.message, true); }
  }));
  $$('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Generate a new temporary password for this user?')) return;
    try {
      const r = await api('/users/' + b.dataset.reset + '/reset-password', { method: 'POST' });
      modal(`<h2>Temporary password</h2><p>Give this to the user — they must change it at next sign-in:</p><div class="secret-box">${esc(r.temporary_password)}</div><div class="foot"><button class="btn primary" onclick="closeModal()">Done</button></div>`);
    } catch (e) { toast(e.message, true); }
  }));
}

async function userModal(roles, u) {
  await refs();
  const m = modal(`<h2>${u ? 'Edit user' : 'New user'}</h2><form id="user-form">
    <div class="field-row">
      <div class="field"><label>Full name *</label><input name="full_name" required value="${esc(u && u.full_name)}"></div>
      <div class="field"><label>Role *</label><select name="role_id" required>${(roles || []).map((r) => `<option value="${r.id}" ${u && u.role_id === r.id ? 'selected' : ''}>${esc(r.name)}${r.requires_2fa ? ' (2FA required)' : ''}</option>`).join('')}</select></div>
    </div>
    ${u ? '' : '<div class="field"><label>Email *</label><input name="email" type="email" required></div>'}
    <div class="field-row">
      <div class="field"><label>Phone</label><input name="phone" value="${esc(u && u.phone)}"></div>
      <div class="field"><label>Branch</label><select name="branch_id">${branchOpts(u && u.branch_id)}</select></div>
    </div>
    ${u ? `<label style="font-size:13px"><input type="checkbox" name="disabled" ${u.status === 'disabled' ? 'checked' : ''}> Disabled</label>` : ''}
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Save user</button></div>
  </form>`, { wide: true });
  $('#user-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (u) {
        await api('/users/' + u.id, { method: 'PUT', body: {
          full_name: f.full_name.value, role_id: Number(f.role_id.value), phone: f.phone.value,
          branch_id: f.branch_id.value ? Number(f.branch_id.value) : null,
          status: f.disabled.checked ? 'disabled' : 'active',
        } });
        toast('User saved'); closeModal(); renderUsers();
      } else {
        const out = await api('/users', { method: 'POST', body: {
          full_name: f.full_name.value, email: f.email.value, role_id: Number(f.role_id.value),
          phone: f.phone.value, branch_id: f.branch_id.value ? Number(f.branch_id.value) : null,
        } });
        closeModal();
        modal(`<h2>User created</h2><p>Temporary password (they must change it at first sign-in):</p><div class="secret-box">${esc(out.temporary_password)}</div><div class="foot"><button class="btn primary" onclick="closeModal()">Done</button></div>`);
        renderUsers();
      }
    } catch (err) { toast(err.message, true); }
  });
}

async function renderRoles() {
  const data = await api('/roles');
  const byModule = {};
  for (const p of data.permissions) (byModule[p.module] = byModule[p.module] || []).push(p);
  $('#sec-content').innerHTML = `
    <div class="toolbar"><div class="muted">Tick a permission cell, then press <b>Save</b> under that role column — changes apply live, no code changes needed. Roles flagged 🔒 force their users through two-factor sign-in.</div>
    ${CAN('roles.edit') ? '<button class="btn primary" id="btn-addrole">+ New role</button>' : ''}</div>
    <div class="card"><div style="overflow-x:auto">
    <table class="matrix tbl"><thead><tr><th>Permission</th>
      ${data.roles.map((r) => `<th class="center" title="${esc(r.description || '')}">${esc(r.name)}${r.requires_2fa ? ' 🔒' : ''}<div class="small muted" style="font-weight:400">save ↓</div></th>`).join('')}
    </tr></thead><tbody>
      ${Object.entries(byModule).map(([mod, perms]) => `
        <tr class="mod-row"><td colspan="${data.roles.length + 1}">${esc(mod)}</td></tr>
        ${perms.map((p) => `<tr><td>${esc(p.label)} <span class="muted small" style="font-family:monospace">${esc(p.code)}</span></td>
          ${data.roles.map((r) => `<td class="center">${CAN('roles.edit') ? `<input type="checkbox" data-role="${r.id}" data-perm="${p.id}" ${r.permissions.includes(p.id) ? 'checked' : ''}>` : (r.permissions.includes(p.id) ? '✓' : '·')}</td>`).join('')}</tr>`).join('')}
      `).join('')}
    </tbody></table></div></div>
    ${CAN('roles.edit') ? `<div class="card"><h2>Save & role options</h2><div class="filters" style="margin-top:8px">
      ${data.roles.map((r) => `<span style="display:inline-flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:6px 12px">
        <b style="font-size:12.5px">${esc(r.name)}</b>
        <button class="btn" style="padding:3px 10px" data-save="${r.id}">Save</button>
        <label class="small"><input type="checkbox" data-2fa-role="${r.id}" ${r.requires_2fa ? 'checked' : ''}> 2FA</label>
      </span>`).join('')}
    </div></div>` : ''}`;

  if (CAN('roles.edit')) {
    $$('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      const roleId = b.dataset.save;
      const perms = $$(`[data-role="${roleId}"]`).filter((c) => c.checked).map((c) => Number(c.dataset.perm));
      try { await api('/roles/' + roleId + '/permissions', { method: 'PUT', body: { permissions: perms } }); toast('Permissions saved'); renderRoles(); }
      catch (e) { toast(e.message, true); }
    }));
    $$('[data-2fa-role]').forEach((c) => c.addEventListener('change', async () => {
      try { await api('/roles/' + c.dataset['2faRole'], { method: 'PUT', body: { requires_2fa: c.checked } }); toast(c.checked ? '2FA now required for this role' : '2FA now optional for this role'); }
      catch (e) { toast(e.message, true); renderRoles(); }
    }));
    const addRole = $('#btn-addrole');
    if (addRole) addRole.addEventListener('click', () => {
      const m = modal(`<h2>New role</h2><form id="role-form">
        <div class="field"><label>Role name *</label><input name="name" required></div>
        <div class="field"><label>Description</label><input name="description"></div>
        <label style="font-size:13px"><input type="checkbox" name="requires_2fa"> Require two-factor authentication</label>
        <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Create role</button></div></form>`);
      $('#role-form', m).addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        body.requires_2fa = body.requires_2fa === 'on';
        try { await api('/roles', { method: 'POST', body }); closeModal(); toast('Role created — tick its permissions and press Save'); renderRoles(); }
        catch (err) { toast(err.message, true); }
      });
    });
  }
}

async function renderAudit() {
  const rows = await api('/roles/audit');
  $('#sec-content').innerHTML = `<div class="card">
    ${rows.length ? `<table class="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td class="muted small" style="width:170px">${dt(a.created_at)}</td><td>${esc(a.user_name || 'system')}</td><td>${esc(a.action)}</td><td class="muted">${esc(a.entity || '')} ${esc(a.entity_id || '')}</td><td class="muted small" style="font-family:monospace">${esc(a.ip || '')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No audit activity yet</div>'}</div>`;
}

/* ================= settings ================= */
let setTab = 'company';
async function viewSettings() {
  await refs(true);
  const tabs = [['company', 'Company'], ['branches', 'Branches'], ['services', 'Services']];
  shell(`
    <div class="topbar"><h1>Settings</h1></div>
    <div class="tabs">${tabs.map(([k, label]) => `<span class="tab ${setTab === k ? 'active' : ''}" data-tab="${k}">${label}</span>`).join('')}</div>
    <div id="set-content" class="center-page"><span class="spin"></span></div>`);
  $$('.tab').forEach((t) => t.addEventListener('click', () => { setTab = t.dataset.tab; viewSettings(); }));
  if (setTab === 'company') await renderCompany();
  else if (setTab === 'branches') await renderBranches();
  else if (setTab === 'services') await renderServices();
}

async function renderCompany() {
  const { settings: s } = await api('/settings');
  $('#set-content').className = '';
  const editable = CAN('settings.edit');
  const fields = [['company_name', 'Company name', s.company_name], ['company_name_ar', 'Company name (Arabic)', s.company_name_ar],
    ['company_trn', 'TRN (Tax Registration Number — printed on invoices)', s.company_trn], ['currency', 'Currency', s.currency],
    ['vat_rate', 'VAT rate %', s.vat_rate], ['company_phone', 'Phone', s.company_phone], ['company_email', 'Email', s.company_email],
    ['company_address', 'Address', s.company_address], ['invoice_footer', 'Invoice footer text', s.invoice_footer]];
  $('#set-content').innerHTML = `<form class="card" id="co-form" style="max-width:640px">
    ${fields.map(([k, label, v]) => `<div class="field"><label>${label}</label>
      <input name="${k}" value="${esc(v || '')}" ${editable ? '' : 'disabled'}></div>`).join('')}
    ${editable ? '<button class="btn primary">Save company settings</button>' : '<div class="muted">Read-only — ask an Admin to change these.</div>'}
  </form>`;
  if (editable) $('#co-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/settings', { method: 'PUT', body: { settings: Object.fromEntries(new FormData(e.target)) } });
      toast('Company settings saved'); renderCompany();
    } catch (err) { toast(err.message, true); }
  });
}

async function renderBranches() {
  $('#set-content').className = '';
  $('#set-content').innerHTML = `
    ${CAN('settings.edit') ? '<div class="toolbar"><button class="btn primary" id="btn-add">+ Add branch</button></div>' : ''}
    <div class="card"><table class="tbl"><thead><tr><th>Branch</th><th>City</th><th>Address</th><th>Phone</th><th>Head office</th><th>Status</th><th class="actions"></th></tr></thead><tbody>
      ${(CACHE.branches || []).map((b) => `<tr><td><b>${esc(b.name)}</b></td><td>${esc(b.city)}</td><td class="muted">${esc(b.address || '—')}</td><td class="muted">${esc(b.phone || '—')}</td>
        <td>${b.is_head_office ? '<span class="badge gold">HQ</span>' : ''}</td>
        <td><span class="badge ${b.active ? 'green' : 'red'}">${b.active ? 'active' : 'hidden'}</span></td>
        <td class="actions">${CAN('settings.edit') ? `<button class="btn" data-edit="${b.id}">Edit</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="muted small" style="margin-left:4px">Branch names are free text — rename them any time (e.g. Head Office – Ajman → any name you prefer).</div>`;
  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => branchModal());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => branchModal((CACHE.branches || []).find((x) => x.id == b.dataset.edit))));
}

async function branchModal(b) {
  const m = modal(`<h2>${b ? 'Edit branch' : 'New branch'}</h2><form id="b-form">
    <div class="field-row">
      <div class="field"><label>Branch name *</label><input name="name" required value="${esc(b && b.name)}"></div>
      <div class="field"><label>City *</label><input name="city" required value="${esc(b && b.city)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Address</label><input name="address" value="${esc(b && b.address)}"></div>
      <div class="field"><label>Phone</label><input name="phone" value="${esc(b && b.phone)}"></div>
    </div>
    <label style="font-size:13px"><input type="checkbox" name="active" ${!b || b.active ? 'checked' : ''}> Active (visible in lists)</label>
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Save branch</button></div></form>`);
  $('#b-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.active = body.active === 'on';
    try {
      b ? await api('/settings/branches/' + b.id, { method: 'PUT', body }) : await api('/settings/branches', { method: 'POST', body });
      closeModal(); toast('Branch saved'); await refs(true); renderBranches();
    } catch (err) { toast(err.message, true); }
  });
}

async function renderServices() {
  $('#set-content').className = '';
  $('#set-content').innerHTML = `
    ${CAN('settings.edit') ? '<div class="toolbar"><button class="btn primary" id="btn-add">+ Add service</button></div>' : ''}
    <div class="card"><table class="tbl"><thead><tr><th>Service</th><th>Arabic name</th><th>Description</th><th>Status</th><th class="actions"></th></tr></thead><tbody>
      ${(CACHE.services || []).map((s) => `<tr><td><b>${esc(s.name)}</b></td><td dir="rtl" class="muted">${esc(s.name_ar || '—')}</td><td class="muted small">${esc(s.description || '')}</td>
        <td><span class="badge ${s.active ? 'green' : 'red'}">${s.active ? 'active' : 'hidden'}</span></td>
        <td class="actions">${CAN('settings.edit') ? `<button class="btn" data-edit="${s.id}">Edit</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => serviceModal());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => serviceModal((CACHE.services || []).find((x) => x.id == b.dataset.edit))));
}

async function serviceModal(s) {
  const m = modal(`<h2>${s ? 'Edit service' : 'New service'}</h2><form id="s-form">
    <div class="field-row">
      <div class="field"><label>Service name *</label><input name="name" required value="${esc(s && s.name)}"></div>
      <div class="field"><label>Arabic name</label><input name="name_ar" value="${esc(s && s.name_ar)}"></div>
    </div>
    <div class="field"><label>Description</label><input name="description" value="${esc(s && s.description)}"></div>
    <label style="font-size:13px"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}> Active</label>
    <div class="foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Save service</button></div></form>`);
  $('#s-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.active = body.active === 'on';
    try {
      s ? await api('/settings/services/' + s.id, { method: 'PUT', body }) : await api('/settings/services', { method: 'POST', body });
      closeModal(); toast('Service saved'); await refs(true); renderServices();
    } catch (err) { toast(err.message, true); }
  });
}

/* ================= router ================= */
const ROUTES = [
  [/^#?\/?$/, viewDashboard],
  [/^#\/dashboard$/, viewDashboard],
  [/^#\/enquiries$/, viewEnquiries],
  [/^#\/customers$/, viewCustomers],
  [/^#\/cases$/, viewCases],
  [/^#\/case\/(\d+)$/, (m) => viewCase(m[1])],
  [/^#\/documents$/, viewDocuments],
  [/^#\/invoices$/, viewInvoices],
  [/^#\/invoice\/(\d+)$/, (m) => viewInvoice(m[1])],
  [/^#\/payroll$/, viewPayroll],
  [/^#\/security$/, viewSecurity],
  [/^#\/settings$/, viewSettings],
];

async function route() {
  if (!TOKEN) return loginView();
  const hash = location.hash || '#/';
  for (const [re, fn] of ROUTES) {
    const m = hash.match(re);
    if (m) {
      try { await fn(m); }
      catch (e) {
        $('#main') ? ($('#main').innerHTML = `<div class="card"><div class="empty">⚠ ${esc(e.message)}<br><br><button class="btn" onclick="location.hash='#/'">Back to dashboard</button></div></div>`) : logout();
      }
      return;
    }
  }
  location.hash = '#/';
}

async function boot() {
  if (!TOKEN) return loginView();
  try {
    const me = await api('/auth/me');
    ME = me.user;
    ME.twofa_enabled = true;
    PERMS = new Set(me.permissions || []);
    if (!location.hash) location.hash = '#/';
    await route();
  } catch (e) {
    if (String(e.message).includes('sign in')) return;
    toast(e.message, true);
  }
}

window.closeModal = closeModal;
window.addEventListener('hashchange', route);
boot();
