import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplexPair } from 'node:stream';
import { connect, createSecureContext, TLSSocket } from 'node:tls';
import { postgresOptions } from '../server/storage-config.mjs';

// Real TLS encryption and certificate validation using the production TLS options.
// Transport is an in-memory stream pair: NO network/socket listener, PostgreSQL,
// SQL, browser, real credential or external service. This is NOT a PG18/TCP test.
const openssl = spawnSync('openssl', ['version'], { stdio: 'ignore' });
const available = !openssl.error && openssl.status === 0 && typeof duplexPair === 'function';

function handshake(options, key, cert, tls12Only = false) {
  const [clientStream, serverStream] = duplexPair();
  const server = new TLSSocket(serverStream, {
    isServer: true,
    secureContext: createSecureContext({ key, cert, minVersion: 'TLSv1.2', ...(tls12Only ? { maxVersion: 'TLSv1.2' } : {}) }),
  });
  // Preserve all production verification options, in particular the explicit
  // host-pinned checkServerIdentity. No rejectUnauthorized:false test escape.
  const client = connect({ ...options.ssl, socket: clientStream });
  server.on('error', () => {});
  server.on('data', data => server.write(data));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('SYNTHETIC_TLS_TIMEOUT')), 3000);
    let settled = false;
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.destroy(); server.destroy(); clientStream.destroy(); serverStream.destroy();
      if (error) reject(error); else resolve(result);
    }
    client.on('error', error => finish(error));
    client.once('secureConnect', () => {
      client.once('data', data => finish(null, {
        authorized: client.authorized,
        protocol: client.getProtocol(),
        cipher: client.getCipher().name,
        data: data.toString(),
      }));
      client.write('synthetic encrypted payload');
    });
  });
}

test('production PostgreSQL TLS settings perform real certificate verification over memory streams', {
  skip: available ? false : 'Not run: installed OpenSSL and Node duplexPair are required; nothing is downloaded',
  timeout: 15000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'anna-synthetic-tls-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Ephemeral local test key only. Never print/archive/transmit it or reuse it.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore', timeout: 10000 });
  const key = await readFile(join(dir, 'key.pem'));
  const cert = await readFile(join(dir, 'cert.pem'), 'utf8');
  const config = { DATABASE_DRIVER: 'postgres', DATABASE_URL: 'postgresql://adapter_synthetic:synthetic-only@127.0.0.1:55434/adapter_synthetic', DATABASE_TLS_CA_PEM: cert };

  await t.test('trusted fixture CA and explicit IP hostname complete TLS and exchange encrypted bytes', async () => {
    const result = await handshake(postgresOptions(config), key, cert);
    assert.equal(result.authorized, true);
    assert.ok(['TLSv1.2', 'TLSv1.3'].includes(result.protocol));
    assert.ok(result.cipher.length > 0);
    assert.equal(result.data, 'synthetic encrypted payload');
  });
  await t.test('an untrusted self-signed fixture is rejected for trust, not timeout or transport failure', async () => {
    const options = postgresOptions({ ...config, DATABASE_TLS_CA_PEM: undefined });
    await assert.rejects(handshake(options, key, cert), error => error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT');
  });
  await t.test('trusted CA does not bypass the production host-pinned hostname check', async () => {
    const options = postgresOptions({ ...config, DATABASE_URL: config.DATABASE_URL.replace('127.0.0.1', 'wrong.example.invalid') });
    await assert.rejects(handshake(options, key, cert), error => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID');
  });
  await t.test('TLS 1.2 is actually negotiable; the lower bound remains an explicit options assertion', async () => {
    const options = postgresOptions(config);
    assert.equal(options.ssl.minVersion, 'TLSv1.2');
    const result = await handshake(options, key, cert, true);
    assert.equal(result.protocol, 'TLSv1.2');
    // A TLS1.1 failure on OpenSSL3 could instead be its security/cipher policy,
    // so it would not independently prove this application's protocol floor.
  });
});
