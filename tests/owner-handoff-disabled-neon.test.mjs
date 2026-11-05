// Network-free contract check with the real Neon client. This proves transport
// shape and response handling, not real PostgreSQL execution or deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const childFlag = '--synthetic-disabled-neon-child';
if (!process.argv.includes(childFlag)) {
  test('disabled release preserves legacy Neon INSERT acknowledgement without owner SQL', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), childFlag], { env: {}, timeout: 30000 });
    assert.match(stdout, /disabled Neon contract passed/);
  });
} else {
  globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST'); };
  const { neonConfig } = await import('@neondatabase/serverless');
  process.env.DATABASE_URL = 'postgresql://synthetic:synthetic-only@handoff.invalid/synthetic';
  process.env.OWNER_HANDOFF_REQUIRED = '1';
  const calls = [];
  neonConfig.fetchFunction = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.equal(body.queries, undefined, 'disabled adapter does not add transaction guards');
    assert.doesNotMatch(body.query, /owner_(?:security|sessions)/i);
    const total = body.query.startsWith('SELECT COUNT(*) AS total FROM media');
    return { ok: true, json: async () => ({
      fields: total ? [{ name: 'total', dataTypeID: 20 }] : [],
      rows: total ? [['0']] : [],
      command: total ? 'SELECT' : 'INSERT',
      rowCount: total ? 1 : 0,
    }) };
  };
  const { database, accessContext, guardMutation } = await import('../server/db.mjs');
  const { query } = await database();
  assert.equal(calls.length, 5, 'only legacy schema and initial content preparation');
  const sql = 'UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version';
  const args = ['{}', 'main', 1];
  assert.deepEqual(guardMutation(sql, args, { legacy: true }), { statement: sql, args });
  await accessContext.run({ epoch: 99, sessionId: 'ignored-disabled-context' }, () => query(sql, args));
  assert.equal(calls.at(-1).query, sql, 'disabled adapter is not request-context-dependent');
  const { createApp } = await import('../server/app.mjs');
  const app = createApp();
  assert.equal(app.router.stack.some(layer => /owner-(handoff|invitation)/.test(String(layer.route?.path))), false);
  const route = app.router.stack.find(layer => layer.route?.path === '/api/media' && layer.route.methods.post);
  const handler = route.route.stack.at(-1).handle;
  let status, result, error;
  const response = { status(value) { status = value; return this; }, json(value) { result = value; return this; } };
  await handler({ body: { base64: Buffer.from('%PDF-synthetic-only').toString('base64'), type: 'application/pdf', name: 'synthetic' } }, response, value => { error = value; });
  assert.equal(error, undefined);
  assert.equal(status, 201, 'successful legacy INSERT returns [] with Neon, not a lost-access failure');
  assert.match(result.url, /^\/api\/media\/[a-f0-9-]+$/);
  assert.equal(calls.at(-1).query, 'INSERT INTO media (id,mime,body,name) VALUES ($1,$2,$3,$4)');
  console.log('disabled Neon contract passed');
}
