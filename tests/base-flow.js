/**
 * Base-mode verification: bootstrap into an empty database, then check the
 * administrator first-sign-in flow (2FA setup -> forced password change).
 * Runs as a child of smoke.test.js; exits 0 on success.
 */
const assert = require('assert');
const { spawnSync } = require('child_process');

(async () => {
  const { createDB } = require('mysql-memory-server');
  const mysqld = await createDB();
  const env = {
    ...process.env,
    DB_HOST: '127.0.0.1',
    DB_PORT: String(mysqld.port),
    DB_USER: mysqld.username,
    DB_PASSWORD: '',
    DB_NAME: 'ertiqaa_base_check',
    JWT_SECRET: 'test-jwt-secret',
    ENCRYPTION_KEY: 'test-encryption-key',
    STORAGE_DIR: process.env.STORAGE_DIR + '-base',
    SEED_MODE: 'base',
    ADMIN_EMAIL: 'admin@ertiqaa.ae',
    ADMIN_PASSWORD: 'Start@Ertiqaa#2026',
  };
  Object.assign(process.env, env);

  const boot = spawnSync(process.execPath, ['scripts/bootstrap.js'], { cwd: require('path').join(__dirname, '..'), env, encoding: 'utf8' });
  assert.strictEqual(boot.status, 0, `base bootstrap failed:\n${boot.stdout}\n${boot.stderr}`);
  console.log(boot.stdout.trim().split('\n').filter((l) => !l.startsWith('ADMIN LOGIN')).join('\n'));

  const app = require('../src/server');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(body && body.tempToken ? {} : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  const totp = require('../src/totp');
  const nowCode = (secret) => totp.hotp(secret, Math.floor(Date.now() / 30000));

  let ok = 0;
  const check = (name, cond) => {
    if (!cond) throw new Error(`FAILED: ${name}`);
    ok++;
    console.log(`  ok - ${name}`);
  };

  let r = await api('POST', '/api/auth/login', { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
  check('base admin goes straight into 2FA setup', r.json.need2fa === true && r.json.need2fa_setup === true);
  const secret = r.json.secret;
  r = await api('POST', '/api/auth/login', { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, token: r.json.tempToken, otp: nowCode(secret) });
  check('base admin must change password after 2FA setup', r.json.mustChangePassword === true && !!r.json.changeToken);
  r = await api('POST', '/api/auth/change-password', { tempToken: r.json.changeToken, newPassword: 'NewPassw0rdLong!' });
  check('change-password accepts the forced change', r.status === 200);
  r = await api('POST', '/api/auth/change-password', { tempToken: r.json.changeToken, newPassword: 'short' });
  check('weak password rejected', r.status >= 400);
  r = await api('POST', '/api/auth/login', { email: env.ADMIN_EMAIL, password: 'NewPassw0rdLong!' });
  check('sign-in with the new password asks for the 2FA code', r.json.need2fa === true);
  r = await api('POST', '/api/auth/login', { email: env.ADMIN_EMAIL, password: 'NewPassw0rdLong!', token: r.json.tempToken, otp: nowCode(secret) });
  check('full sign-in works, no further change forced', !!r.json.token && r.json.mustChangePassword === false);

  server.close();
  try { await mysqld.stop(); } catch {}
  console.log(`  base-mode flow: ${ok} checks passed`);
  process.exit(0);
})().catch((e) => {
  console.error('BASE FLOW FAILED:', e.message);
  process.exit(1);
});
