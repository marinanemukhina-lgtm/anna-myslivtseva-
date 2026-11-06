import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { createSyntheticBookingApp } from '../server/synthetic-booking-http.mjs';

// No dotenv, database configuration, migrations, external services or credentials.
if (process.env.BOOKING_DEMO_MODE !== 'synthetic-only') throw Error('BOOKING_DEMO_MODE=synthetic-only required');
const app = createSyntheticBookingApp({ enabled: true });
const server = createServer(app);
app.get('/', (_req, res) => res.redirect('/booking-demo.html'));
const vite = await createVite({ configFile: false, root: process.cwd(), resolve: { alias: { 'node:crypto': new URL('../src/demo-random.mjs', import.meta.url).pathname } }, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
app.use(vite.middlewares);
server.listen(4187, '127.0.0.1', () => console.log('Synthetic in-memory demo: http://127.0.0.1:4187/booking-demo.html'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(); vite.close().then(() => process.exit()); });
