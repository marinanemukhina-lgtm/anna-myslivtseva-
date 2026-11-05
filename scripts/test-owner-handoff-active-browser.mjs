// Test-only runner: physically copies source, selects active mode in that copy,
// builds it, then runs the existing claim-page tests. Never alters release source.
import { spawn } from 'node:child_process';
import { cp, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
import { createActiveOwnerSource } from '../tests/helpers/active-owner-source.mjs';
const fixture = await createActiveOwnerSource(undefined, { ui: true });
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: fixture.root, stdio: 'inherit', env: {
    PATH: process.env.PATH, HOME: process.env.HOME,
    // Optional Playwright browser location/official Chrome channel, not app mode.
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
    ...(process.env.BOOKING_SYSTEM_CHROMIUM ? { BOOKING_SYSTEM_CHROMIUM: process.env.BOOKING_SYSTEM_CHROMIUM } : {}),
    ...(process.env.BOOKING_SYSTEM_CHROME ? { BOOKING_SYSTEM_CHROME: process.env.BOOKING_SYSTEM_CHROME } : {}),
  } });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Active browser check exited ${code}`)));
});
try {
  await run(['node_modules/vite/bin/vite.js', 'build']);
  await run(['scripts/prepare-sites-build.mjs']);
  await run(['node_modules/@playwright/test/cli.js', 'test', 'tests/browser/owner-claim.spec.mjs', ...process.argv.slice(2)]);
} finally {
  // Keep synthetic traces/reports for review after removing the isolated source.
  try {
    await access(path.join(fixture.root, '.qa'));
    const destination = path.join(sourceRoot, '.qa', 'owner-handoff-active');
    await mkdir(destination, { recursive: true });
    await cp(path.join(fixture.root, '.qa'), destination, { recursive: true });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  finally { await fixture.cleanup(); }
}
