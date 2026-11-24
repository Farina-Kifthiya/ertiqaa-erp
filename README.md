# Ertiqaa ERP

A web-based ERP for **Ertiqaa** (ertiqaa.ae) — AECB credit-case resolution.
Runs **100% locally on your Windows PC**. No cloud, no deployment, no Docker required.

Gold brand colour `#d6a12e` · AED / 5% VAT invoicing · Ajman head office.

---

## What's inside

```
ertiqaa-erp/
├─ database/
│  ├─ schema.sql         Create/drop the ertiqaa_erp database + 18 tables (opens in HeidiSQL)
│  └─ seed.sql           Full fictional demo data in ONE file (schema + data, opens in HeidiSQL)
├─ src/
│  ├─ server.js          Express app (API + frontend, one process)
│  ├─ config.js          Reads .env; creates storage/ folders
│  ├─ db.js              MariaDB/MySQL pool helper
│  ├─ crypto.js          AES-256-GCM file encryption + signed-link tokens
│  ├─ totp.js            2FA codes (Google/Microsoft Authenticator compatible)
│  ├─ middleware.js      JWT auth + permission checks + audit trail writer
│  ├─ routes/            13 API modules (auth, enquiries, webhook, customers, cases,
│  │                     documents, files, invoices, payroll, users, roles, settings, dashboard)
│  └─ public/            The web app (no build tools - plain HTML/CSS/JS)
├─ scripts/
│  ├─ bootstrap.js       Runs automatically on npm start (creates schema, seeds, builds demo files)
│  ├─ build-seed.js      Generates base or demo seed SQL
│  └─ backup.js          Full .sql backup to storage/backups/
├─ tests/                End-to-end smoke test (npm test) - optional
├─ .env.example          Configuration template
└─ package.json
```

## Features

- **Users & Security → Roles & Permissions screen** — add roles and toggle any of the
  27 permissions per role **in the web app, no code changes**. 7 seeded roles
  (Admin, Manager, Credit, Finance, Sales, HR, Viewer); Admin, Credit and Finance
  **require 2FA** (toggleable per role).
- **Branches** — Head Office – Ajman + sample Dubai and Abu Dhabi branches,
  all renamable in Settings.
- **Services** — the 7 services from ertiqaa.ae (Personal Loan, High DBR, Low eScore,
  Past Delays or Defaults, Returned Cheques, Credit Issue Review, Corporate Bank Account),
  editable in Settings.
- **Enquiries** — intake from the website via a secure webhook
  (`POST /api/webhook/enquiry`); WhatsApp and calls logged manually. Status flow
  new → contacted → qualified → converted/lost; one click converts an enquiry into a case.
- **Cases** — 16-status AECB resolution pipeline (ERC-YYYY-#### numbers), priority,
  assignment, notes and automatic status history.
- **Documents** — uploaded files are **encrypted at rest (AES-256-GCM)** and downloaded
  only through **short-lived signed links**.
- **Invoicing** — AED, 5% VAT, TRN field, server-computed totals, payment tracking
  (draft → sent → partial → paid), branded **PDF invoices**.
- **Payroll** — simple monthly register (no WPS export).
- **Audit log** — every important action is recorded.
- **Login** — email + password (+ 2FA), forced password change on first sign-in.

---

## Quick start (Windows)

1. **Install Node.js** (18 or newer): https://nodejs.org → "LTS" installer → Next → Next.

2. **Install MariaDB or MySQL:**
   - Easiest: **XAMPP** (https://www.apachefriends.org) → install → open
     "XAMPP Control Panel" → Start **MySQL**.
   - Or the MariaDB MSI installer from https://mariadb.org/download/
     (remember the root password you set).

3. **Unzip this folder** somewhere like `C:\ertiqaa-erp`.

4. **Open PowerShell in that folder** (Shift + Right-click in the folder →
   "Open PowerShell window here") and run:

   ```powershell
   npm install
   copy .env.example .env
   notepad .env
   ```

5. In `.env`:
   - set `DB_PASSWORD` to your MariaDB root password,
   - set `JWT_SECRET` and `ENCRYPTION_KEY` to two **long random strings**,
   - set `ADMIN_EMAIL` / `ADMIN_PASSWORD` for your first administrator,
   - keep `SEED_MODE=base` for real use (or `demo` to explore with fake data).

6. **Start it:**

   ```powershell
   npm start
   ```

7. Open **http://localhost:3000** and sign in with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
   You will set up 2FA (scan or paste the key into Google/Microsoft Authenticator)
   and choose your own password at first sign-in.

> The first `npm start` creates the database and tables automatically.
> You never have to touch HeidiSQL for it to work — but you can.

---

## Exploring with demo data

Set `SEED_MODE=demo` in `.env`, then load/point the app at an **empty** database
(or just run `npm start` on a fresh one). You get fictional data: 12 users,
64 customers, 69 cases across all 16 statuses, 90 enquiries, 414 documents
(encrypted placeholder files generated automatically) and ~40 invoices.
Demo password for every seeded user: `Ertiqaa@2026!`

**Never use demo mode with real client data.**

---

## HeidiSQL route (optional)

1. Open HeidiSQL → connect to your MariaDB.
2. File → Run SQL file → `database/seed.sql` → F9. That single file creates
   `ertiqaa_erp` with the full demo dataset.
3. (Base mode alternative: run `database/schema.sql` alone, then set
   `SEED_MODE=base` and start the app — the admin account is created on first start.)

---

## Backups

```powershell
npm run backup
```

Writes a full `.sql` backup to `storage/backups/ertiqaa-YYYYMMDD-HHMMSS.sql`.
Restore any time with HeidiSQL (File → Run SQL file).

**Important:** documents are encrypted with your `ENCRYPTION_KEY`. Back up
your `.env` keep-safe — if you lose `ENCRYPTION_KEY`, stored documents can no
longer be decrypted.

---

## Website form hookup (later, when the site is ready)

Point the ertiqaa.ae contact form to:

```
POST http://localhost:3000/api/webhook/enquiry
X-Webhook-Secret: <value from WEBHOOK_SECRET in .env>
Content-Type: application/json

{ "name": "...", "phone": "...", "email": "...", "service": "Returned Cheques", "message": "..." }
```

A matching customer is found (by phone) or created, and a `ENQ-W-####` website
enquiry appears in the app. Leave `WEBHOOK_SECRET` empty to disable the endpoint.

---

## Changing roles & permissions

Users & Security → Roles & Permissions tab: tick/untick any permission per role
and press Save — effective immediately for every user of that role. You can also
toggle the per-role 2FA requirement and add brand-new roles.

## Daily upgrade of the demo logo

The app ships with a gold `ERTIQAA / ارتقاء` wordmark (`src/public/assets/logo.svg`).
To use the real logo, save `https://ertiqaa.ae/assets/logo-600.png` as
`src/public/assets/logo-600.png` and reference it from `index.html` — or send it
to me and I'll drop it in.

## Tests (optional)

```powershell
npm test
```

Downloads a throwaway temporary MySQL, exercises all 10 areas (bootstrap both modes,
2FA, RBAC, cases, documents/signed links, invoices/VAT/PDF, payroll, dashboard, backup,
HeidiSQL path) and cleans up after itself. Requires internet on first run.
