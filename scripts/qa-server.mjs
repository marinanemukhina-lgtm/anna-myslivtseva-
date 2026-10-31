// Isolated test fixture only. Never used by production start/build.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'anna-browser-'));
process.env.ADMIN_PASSWORD_HASH = 'browser-fixture:' + scryptSync('browser-fixture-only-password', 'browser-fixture', 64).toString('hex');
process.env.PORT = '4176';
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
const { default: express } = await import('express');
const { createApp } = await import('../server/app.mjs');
const { resolve } = await import('node:path');
const app = createApp();
app.use(express.static('dist/client'));
app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
app.listen(4176, '127.0.0.1');
