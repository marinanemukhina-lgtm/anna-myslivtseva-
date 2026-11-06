import { createSyntheticBookingDemo, createSyntheticMemoryStore, syntheticFixture, DEMO_NOW } from '../server/synthetic-booking-demo.mjs';

// One isolated tab, same tested engine. No network, patient input, real calendar,
// IndexedDB or production API. Refresh intentionally resets the demonstration.
const started = Date.now(), now = () => DEMO_NOW + Date.now() - started;
const demos = Object.fromEntries(['fresh','stale','incomplete'].map(mode => [mode,
  createSyntheticBookingDemo({ store: createSyntheticMemoryStore(syntheticFixture(mode)), now })]));
const sessions = new Map();
self.onmessage = async ({ data: { id, path, body, session } }) => {
  try {
    let result;
    if (path === 'session') {
      if (!body || Object.keys(body).join(',') !== 'mode' || !Object.hasOwn(demos, body.mode)) throw Object.assign(Error(), { code: 'INVALID_INPUT' });
      const engine = demos[body.mode], token = engine.session(); sessions.set(token, engine);
      result = { session: token, syntheticOnly: true };
    } else {
      const engine = sessions.get(session);
      if (!engine) throw Object.assign(Error(), { code: 'UNAUTHORIZED' });
      const [method, query] = path.split('?');
      if (method === 'availability') result = await engine.available(session, Object.fromEntries(new URLSearchParams(query)));
      else if (['reserve','confirm','cancel'].includes(method)) result = await engine[method](session, body);
      else if (['requests','config'].includes(method)) result = await engine[method](session);
      else throw Object.assign(Error(), { code: 'INVALID_INPUT' });
    }
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.code ?? 'DEMO_UNAVAILABLE' }); }
};
