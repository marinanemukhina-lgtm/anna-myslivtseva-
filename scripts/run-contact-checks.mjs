// No-install runner. Never loads dotenv, inherits DB/admin configuration,
// downloads dependencies/images/browsers, starts cloud resources or deploys.
import { accessSync, constants, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const mode = process.argv[2];
const argument = process.argv[3];
const clean = { PATH: process.env.PATH || '', HOME: process.env.HOME || '', LANG: 'C.UTF-8', TZ: 'UTC' };
const stop = message => { console.error(`NOT RUN: ${message}`); process.exit(2); };
const requireFile = path => { try { accessSync(path, constants.R_OK); } catch { stop(`Required installed file is missing: ${path}`); } };
const installed = (name, args = ['--version']) => spawnSync(name, args, { env: clean, stdio: 'ignore' }).status === 0;
function run(args, extra = {}) {
  const result = spawnSync(process.execPath, args, { env: { ...clean, ...extra }, stdio: 'inherit' });
  if (result.error) stop('Could not start the existing Node runtime');
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!['local', 'tls', 'pg16', 'pg18', 'browser-list', 'browser'].includes(mode)) {
  console.log(`Usage: node scripts/run-contact-checks.mjs MODE [ARGUMENT]
  local        Synthetic unit, build, Sites and compiled worker checks
  tls          Real TLS over memory streams, no network/PostgreSQL/browser
  pg16         Existing disposable loopback PG16 fixtures on 55432 and 55433
  pg18 CA.pem  Existing disposable loopback PG18 TLS fixture on 55434
  browser-list List specs without launching a browser or server
  browser /absolute/executable
               Chromium checks ONLY in an environment where browser/socket
               execution is already permitted. Do not retry a known denial.
No mode installs or downloads anything. PG modes require the documented
empty, pre-created synthetic fixtures.
Do not bypass runtime restrictions with altered security flags or privileges.`);
  process.exit(0);
}
// Vite and other tools may load local env files even when the process is clean.
// Refuse them rather than reading or changing their contents.
if (readdirSync('.').some(name => name.startsWith('.env') && name !== '.env.example')) stop('Remove this runner from a checkout containing runtime .env files; use a clean isolated source snapshot');
requireFile('node_modules/.package-lock.json');
if (mode === 'local') {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const files = pkg.scripts.test.split(' ').slice(2);
  if (!files.every(file => /^tests\/[a-z0-9-]+\.test\.mjs$/.test(file))) stop('Unexpected unit test command');
  run(['scripts/restore-media.mjs']);
  run(['--test', '--test-concurrency=1', ...files]);
  run(['node_modules/vite/bin/vite.js', 'build']);
  run(['scripts/prepare-sites-build.mjs']);
  run(['--test', 'tests/sites-worker.test.mjs']);
  run(['scripts/verify-browser-booking.mjs']);
} else if (mode === 'tls') {
  if (!installed('openssl', ['version'])) stop('OpenSSL is not installed; no download attempted');
  run(['--test', 'tests/postgres-tls.test.mjs']);
} else if (mode === 'pg16') {
  if (!installed('psql')) stop('psql is not installed; actual PG16 checks remain unrun');
  run(['--test', '--test-concurrency=1', 'tests/callbacks-postgres.test.mjs', 'tests/private-booking-postgres.test.mjs'], {
    CALLBACK_POSTGRES_TEST_ALLOW_WRITE: 'synthetic-only',
    CALLBACK_POSTGRES_TEST_URL: 'postgresql://callback_synthetic:callback-synthetic-only@127.0.0.1:55433/callback_synthetic',
    BOOKING_POSTGRES_TEST_ALLOW_WRITE: 'synthetic-only',
    BOOKING_POSTGRES_TEST_URL: 'postgresql://booking_synthetic:booking-synthetic-only@127.0.0.1:55432/booking_synthetic',
  });
} else if (mode === 'pg18') {
  if (!argument) stop('Explicit public certificate file for the disposable PG18 TLS fixture is required');
  requireFile(argument);
  run(['--test', '--test-concurrency=1', 'tests/postgres-adapter.test.mjs', 'tests/postgres-native.test.mjs'], {
    POSTGRES_NATIVE_TEST_ALLOW_WRITE: 'synthetic-only',
    POSTGRES_NATIVE_TEST_URL: 'postgresql://adapter_synthetic:adapter-synthetic-only@127.0.0.1:55434/adapter_synthetic',
    POSTGRES_NATIVE_TEST_CA_PEM: readFileSync(argument, 'utf8'),
  });
} else {
  requireFile('node_modules/@playwright/test/cli.js');
  if (mode === 'browser-list') {
    run(['node_modules/@playwright/test/cli.js', 'test', '--list']);
    run(['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.contact.config.mjs', '--list']);
  } else {
    if (!argument || !isAbsolute(argument)) stop('An explicit absolute path to an already installed Chromium is required');
    try { accessSync(argument, constants.X_OK); } catch { stop('The supplied browser is not executable; no install attempted'); }
    requireFile('dist/client/index.html');
    const extra = { PLAYWRIGHT_EXECUTABLE_PATH: resolve(argument) };
    // Same Playwright transport and existing defaults. No policy/sandbox flags,
    // privilege escalation, patched browser or substitute driver is introduced.
    run(['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.contact.config.mjs', '--project=contact-chromium-desktop', '--project=contact-chromium-small'], extra);
    run(['node_modules/@playwright/test/cli.js', 'test', 'tests/browser/contact-actions.spec.mjs', 'tests/browser/contact-navigation.spec.mjs', 'tests/browser/home-journey.spec.mjs', '--project=chromium-desktop', '--project=chromium-mobile'], extra);
  }
}
