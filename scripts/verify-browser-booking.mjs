import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomBytes, webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';

// Executes the actual compiled worker, not a second implementation. This checks
// the browser build/crypto alias/transport; it is not a visual browser test.
const file = (await readdir('dist/client/assets')).find(name => /^booking-demo-worker-.*\.js$/.test(name));
assert.ok(file);
const source = await readFile(`dist/client/assets/${file}`, 'utf8');
let response;
const self = { postMessage: data => { response = structuredClone(data); } };
runInNewContext(source, { self, crypto: webcrypto, URLSearchParams, structuredClone, console, setTimeout, clearTimeout });
let id = 0;
async function call(path, body, session) {
  response = undefined; await self.onmessage({ data: { id: ++id, path, body, session } });
  assert.ok(response); assert.equal(response.error, undefined); return response.result;
}
const { session } = await call('session', { mode: 'fresh' });
const config = await call('config', null, session);
const a = await call(`availability?serviceId=demo-60&date=${config.date}`, null, session);
assert.equal(a.ready, true);
const r = await call('reserve', { expectedVersion: a.version, operationKey: randomBytes(24).toString('hex'), persona: config.personas[0], serviceId: 'demo-60', date: config.date, start: a.slots[0].start }, session);
const c = await call('confirm', { id: r.id, expectedVersion: r.version }, session); assert.equal(c.status, 'confirmed');
const x = await call('cancel', { id: c.id, expectedVersion: c.version }, session); assert.equal(x.status, 'cancelled');
for (const mode of ['stale','incomplete']) {
 const next = await call('session', { mode });
 const result = await call(`availability?serviceId=demo-60&date=${config.date}`, null, next.session);
 assert.equal(result.ready, false); assert.deepEqual(result.slots, []);
}
console.log('Compiled browser worker: reserve, confirm, cancel, stale and incomplete sources passed.');
