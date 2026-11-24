-- ============================================================
-- Ertiqaa ERP - database schema
-- Opens directly in HeidiSQL. Safe to re-run on an empty server;
-- it recreates the ertiqaa_erp database from scratch (all data lost).
-- The app's bootstrap script loads this file automatically when needed.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP DATABASE IF EXISTS ertiqaa_erp;
CREATE DATABASE ertiqaa_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ertiqaa_erp;

-- ---------- reference / security ----------

CREATE TABLE branches (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120) NOT NULL,
  city          VARCHAR(80)  NOT NULL,
  address       VARCHAR(255) NULL,
  phone         VARCHAR(40)  NULL,
  is_head_office TINYINT(1)  NOT NULL DEFAULT 0,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE services (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120) NOT NULL,
  name_ar     VARCHAR(120) NULL,
  description VARCHAR(255) NULL,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE roles (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(60)  NOT NULL,
  description  VARCHAR(255) NULL,
  requires_2fa TINYINT(1)   NOT NULL DEFAULT 0,
  is_system    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE permissions (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code  VARCHAR(64)  NOT NULL,
  module VARCHAR(40) NOT NULL,
  label VARCHAR(120) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE role_permissions (
  role_id       INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY fk_rp_permission (permission_id),
  CONSTRAINT fk_rp_role       FOREIGN KEY (role_id)       REFERENCES roles (id)       ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id            INT UNSIGNED NULL,
  role_id              INT UNSIGNED NOT NULL,
  full_name            VARCHAR(120) NOT NULL,
  email                VARCHAR(160) NOT NULL,
  phone                VARCHAR(40)  NULL,
  password_hash        VARCHAR(100) NOT NULL,
  twofa_secret         VARCHAR(64)  NULL,
  twofa_enabled        TINYINT(1)   NOT NULL DEFAULT 0,
  must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
  status               ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at        DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY fk_users_branch (branch_id),
  KEY fk_users_role (role_id),
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
  CONSTRAINT fk_users_role   FOREIGN KEY (role_id)   REFERENCES roles (id)    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- customers & enquiries ----------

CREATE TABLE customers (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(20)  NOT NULL,
  full_name   VARCHAR(160) NOT NULL,
  name_ar     VARCHAR(160) NULL,
  email       VARCHAR(160) NULL,
  phone       VARCHAR(40)  NOT NULL,
  emirates_id VARCHAR(40)  NULL,
  nationality VARCHAR(60)  NULL,
  city        VARCHAR(60)  NULL,
  branch_id   INT UNSIGNED NULL,
  source      VARCHAR(40)  NULL,
  status      ENUM('active','archived') NOT NULL DEFAULT 'active',
  notes       TEXT         NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_code (code),
  KEY fk_customers_branch (branch_id),
  KEY ix_customers_phone (phone),
  CONSTRAINT fk_customers_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
  CONSTRAINT fk_customers_user   FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE enquiries (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ref         VARCHAR(24)  NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  channel     ENUM('website','whatsapp','call','walkin','other') NOT NULL DEFAULT 'other',
  service_id  INT UNSIGNED NULL,
  branch_id   INT UNSIGNED NULL,
  assigned_to INT UNSIGNED NULL,
  status      ENUM('new','contacted','qualified','converted','lost') NOT NULL DEFAULT 'new',
  message     TEXT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_enquiries_ref (ref),
  KEY fk_enquiries_customer (customer_id),
  KEY fk_enquiries_service (service_id),
  KEY fk_enquiries_branch (branch_id),
  KEY fk_enquiries_assigned (assigned_to),
  CONSTRAINT fk_enquiries_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_enquiries_service  FOREIGN KEY (service_id)  REFERENCES services (id)  ON DELETE SET NULL,
  CONSTRAINT fk_enquiries_branch   FOREIGN KEY (branch_id)   REFERENCES branches (id)  ON DELETE SET NULL,
  CONSTRAINT fk_enquiries_assigned FOREIGN KEY (assigned_to) REFERENCES users (id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- cases ----------

CREATE TABLE cases (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_no     VARCHAR(24)  NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  service_id  INT UNSIGNED NULL,
  branch_id   INT UNSIGNED NULL,
  assigned_to INT UNSIGNED NULL,
  status      ENUM('new','documents_requested','documents_received','under_review',
                   'aecb_report_requested','aecb_report_received','bank_negotiation',
                   'offer_proposed','client_approval','settlement_agreed',
                   'payment_plan_active','monitoring','resolved','on_hold',
                   'rejected','withdrawn') NOT NULL DEFAULT 'new',
  priority    ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  notes       TEXT NULL,
  opened_at   DATE NOT NULL,
  closed_at   DATE NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cases_no (case_no),
  KEY fk_cases_customer (customer_id),
  KEY fk_cases_service (service_id),
  KEY fk_cases_branch (branch_id),
  KEY fk_cases_assigned (assigned_to),
  KEY ix_cases_status (status),
  CONSTRAINT fk_cases_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_cases_service  FOREIGN KEY (service_id)  REFERENCES services (id)  ON DELETE SET NULL,
  CONSTRAINT fk_cases_branch   FOREIGN KEY (branch_id)   REFERENCES branches (id)  ON DELETE SET NULL,
  CONSTRAINT fk_cases_assigned FOREIGN KEY (assigned_to) REFERENCES users (id)     ON DELETE SET NULL,
  CONSTRAINT fk_cases_creator  FOREIGN KEY (created_by)  REFERENCES users (id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE case_notes (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NULL,
  note       TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY fk_notes_case (case_id),
  KEY fk_notes_user (user_id),
  CONSTRAINT fk_notes_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE case_history (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id     INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NULL,
  from_status VARCHAR(40) NULL,
  to_status   VARCHAR(40) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY fk_history_case (case_id),
  CONSTRAINT fk_history_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- documents ----------

CREATE TABLE documents (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id   INT UNSIGNED NOT NULL,
  case_id       INT UNSIGNED NULL,
  uploaded_by   INT UNSIGNED NULL,
  title         VARCHAR(160) NOT NULL,
  doc_type      VARCHAR(60)  NOT NULL DEFAULT 'other',
  original_name VARCHAR(255) NOT NULL,
  mime          VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  size          INT UNSIGNED NOT NULL DEFAULT 0,
  storage_path  VARCHAR(255) NOT NULL,
  sha256        CHAR(64)     NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY fk_documents_customer (customer_id),
  KEY fk_documents_case (case_id),
  KEY fk_documents_uploader (uploaded_by),
  CONSTRAINT fk_documents_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_case     FOREIGN KEY (case_id)     REFERENCES cases (id)     ON DELETE SET NULL,
  CONSTRAINT fk_documents_uploader FOREIGN KEY (uploaded_by) REFERENCES users (id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- invoicing ----------

CREATE TABLE invoices (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_no  VARCHAR(24)  NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  case_id     INT UNSIGNED NULL,
  branch_id   INT UNSIGNED NULL,
  status      ENUM('draft','sent','paid','partial','void') NOT NULL DEFAULT 'draft',
  issue_date  DATE NOT NULL,
  due_date    DATE NOT NULL,
  subtotal    DECIMAL(12,2) NOT NULL DEFAULT 0,
  vat_rate    DECIMAL(5,2)  NOT NULL DEFAULT 5.00,
  vat_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  trn         VARCHAR(40) NULL,
  notes       TEXT NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoices_no (invoice_no),
  KEY fk_invoices_customer (customer_id),
  KEY fk_invoices_case (case_id),
  KEY fk_invoices_branch (branch_id),
  CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_invoices_case     FOREIGN KEY (case_id)     REFERENCES cases (id)     ON DELETE SET NULL,
  CONSTRAINT fk_invoices_branch   FOREIGN KEY (branch_id)   REFERENCES branches (id)  ON DELETE SET NULL,
  CONSTRAINT fk_invoices_creator  FOREIGN KEY (created_by)  REFERENCES users (id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE invoice_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id  INT UNSIGNED NOT NULL,
  description VARCHAR(255) NOT NULL,
  qty         DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total  DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY fk_items_invoice (invoice_id),
  CONSTRAINT fk_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payments (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id  INT UNSIGNED NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  method      ENUM('cash','bank','card','other') NOT NULL DEFAULT 'bank',
  reference   VARCHAR(80) NULL,
  paid_at     DATETIME NOT NULL,
  recorded_by INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY fk_payments_invoice (invoice_id),
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- payroll ----------

CREATE TABLE payroll (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  period        CHAR(7)      NOT NULL,
  branch_id     INT UNSIGNED NULL,
  employee_name VARCHAR(160) NOT NULL,
  user_id       INT UNSIGNED NULL,
  basic         DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowances    DECIMAL(12,2) NOT NULL DEFAULT 0,
  deductions    DECIMAL(12,2) NOT NULL DEFAULT 0,
  net           DECIMAL(12,2) NOT NULL DEFAULT 0,
  status        ENUM('draft','paid') NOT NULL DEFAULT 'draft',
  paid_at       DATETIME NULL,
  notes         VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY fk_payroll_branch (branch_id),
  KEY fk_payroll_user (user_id),
  KEY ix_payroll_period (period),
  CONSTRAINT fk_payroll_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
  CONSTRAINT fk_payroll_user   FOREIGN KEY (user_id)   REFERENCES users (id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- misc ----------

CREATE TABLE settings (
  skey   VARCHAR(60)  NOT NULL,
  svalue TEXT NULL,
  PRIMARY KEY (skey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NULL,
  action     VARCHAR(60)  NOT NULL,
  entity     VARCHAR(40)  NULL,
  entity_id  VARCHAR(40)  NULL,
  meta       VARCHAR(500) NULL,
  ip         VARCHAR(45)  NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY fk_audit_user (user_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
