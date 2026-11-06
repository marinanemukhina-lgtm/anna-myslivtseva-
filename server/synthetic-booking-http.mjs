import express from 'express';
import { createSyntheticBookingDemo, createSyntheticMemoryStore, syntheticFixture, DEMO_NOW } from './synthetic-booking-demo.mjs';
import { closePublicIntake, registerBookingPreparation } from './booking.mjs';

// Explicit standalone entry point only. Not imported by app.mjs, API or worker.
export function createSyntheticBookingApp({ enabled = false, now, engines } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const started = Date.now();
  const clock = now ?? (() => DEMO_NOW + Date.now() - started);
  const demos = engines ?? Object.fromEntries(['fresh', 'stale', 'incomplete'].map(mode => [mode,
    createSyntheticBookingDemo({ store: createSyntheticMemoryStore(syntheticFixture(mode)), now: clock })]));
  // Reuse the real closed route, before JSON parsing, even in this demo.
  closePublicIntake(app);
  registerBookingPreparation(app, (_req, res) => res.sendStatus(401));
  if (!enabled) { app.use('/api', (_req, res) => res.sendStatus(404)); return app; }
  const sessions = new Map();
  app.use('/api/demo', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return res.status(403).json({ code: 'INVALID_ORIGIN' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ code: 'JSON_REQUIRED' });
    next();
  });
  app.use(express.json({ limit: '4kb' }));
  app.post('/api/demo/booking/session', (req, res) => {
    if (!req.body || Object.keys(req.body).join(',') !== 'mode' || !['fresh','stale','incomplete'].includes(req.body.mode)) return res.status(400).json({ code: 'INVALID_INPUT' });
    if (sessions.size >= 100) return res.status(429).json({ code: 'DEMO_SESSION_LIMIT' });
    const engine = demos[req.body.mode], session = engine.session(); sessions.set(session, engine);
    res.json({ session, syntheticOnly: true });
  });
  app.use('/api/demo', (req, res, next) => {
    req.demoSession = req.headers['x-demo-session']; req.demo = sessions.get(req.demoSession);
    if (!req.demo) return res.status(401).json({ code: 'UNAUTHORIZED' });
    next();
  });
  const action = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (error) {
      const code = error.code ?? 'STORAGE_UNAVAILABLE';
      const status = code === 'INVALID_INPUT' ? 400 : code === 'UNAUTHORIZED' ? 401 : code === 'RECORD_NOT_FOUND' ? 404 : code.startsWith('STORAGE') ? 503 : 409;
      res.status(status).json({ code });
    }
  };
  app.get('/api/demo/booking/config', action(req => req.demo.config(req.demoSession)));
  app.get('/api/demo/booking/availability', action(req => req.demo.available(req.demoSession, req.query)));
  app.get('/api/demo/booking/requests', action(req => req.demo.requests(req.demoSession)));
  for (const method of ['reserve', 'confirm', 'cancel']) app.post(`/api/demo/booking/${method}`, action(req => req.demo[method](req.demoSession, req.body)));
  app.use('/api', (_req, res) => res.sendStatus(404));
  app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ code: 'INVALID_INPUT' }));
  return app;
}
