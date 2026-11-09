import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { contactMethods } from '../src/contact-methods.mjs';
import { normalizeCallbackPhone } from '../shared/callbacks.mjs';
import { syntheticCallbackConsent } from './helpers/callback-policy.mjs';

const source = await readFile(new URL('../src/CallbackForm.jsx', import.meta.url), 'utf8');
const compiled = await transform(source
  .replace('import React, { useEffect, useRef, useState } from "react";', '')
  .replace('import { contactMethods } from "./contact-methods.mjs";', '')
  .replace('import { normalizeCallbackPhone } from "../shared/callbacks.mjs";', '')
  .replace('import "./contact.css";', '')
  .replace('export default function CallbackForm', 'function CallbackForm'), { loader: 'jsx' });
const CallbackForm = new Function('React', 'useEffect', 'useRef', 'useState', 'contactMethods', 'normalizeCallbackPhone', compiled.code + '; return CallbackForm;')(React, React.useEffect, React.useRef, React.useState, contactMethods, normalizeCallbackPhone);

test('separate callback section collects nothing before server configuration, retaining safe direct phone handling', () => {
  const html = renderToStaticMarkup(React.createElement(CallbackForm, { profile: { phone: '+7 (900) 000-00-01' } }));
  assert.match(html, /Проверяем доступность/);
  assert.match(html, /href="tel:\+79000000001"/);
  assert.doesNotMatch(html, /<form|<input|<button/);
  const invalid = renderToStaticMarkup(React.createElement(CallbackForm, { profile: { phone: 'javascript:+79000000001' } }));
  assert.doesNotMatch(invalid, /href="tel:|javascript:/);
});

test('callback uses the existing retry and consent contract without storing phone in browser storage', () => {
  assert.match(source, /normalizeCallbackPhone\(number\)/);
  assert.match(source, /operation\.current = \{ requestId: crypto\.randomUUID\(\), consentVersion: config\.consentVersion \}/);
  assert.match(source, /sessionStorage\.setItem\(retryStorageKey, JSON\.stringify\(operation\.current\)\)/);
  assert.match(source, /result\.ok !== true \|\| result\.requestId !== operation\.current\.requestId/);
  assert.match(source, /CONSENT_CHANGED/);
  assert.match(source, /saved \? "Заявка сохранена"/);
  assert.doesNotMatch(source, /Заявка сохранена\./);
  assert.doesNotMatch(source, /localStorage|name="(?:name|email|message|diagnosis)"|messages\.map/);
});

test('synthetic callback storage preserves CMS/social/legal text, private settings, marketing, media and owner state', async t => {
  for (const key of ['DATABASE_URL', 'DATABASE_DRIVER', 'DATABASE_TLS_CA_PEM', 'VERCEL', 'VERCEL_ENV', 'CONTACT_CALLBACK_ENABLED', 'CONTACT_CALLBACK_DATA_APPROVED', 'CONTACT_CALLBACK_RELEASE_VERSION']) delete process.env[key];
  const dir = await mkdtemp(join(tmpdir(), 'anna-callback-main-integration-'));
  process.env.DATA_DIR = dir;
  process.env.ADMIN_PASSWORD_HASH = 'synthetic-integration:' + scryptSync('synthetic-only-password', 'synthetic-integration', 64).toString('hex');
  const { createApp } = await import('../server/app.mjs');
  const { database, readContent } = await import('../server/db.mjs');
  const db = await database();
  const initial = await readContent();
  initial.data.profile.callbackConsent = syntheticCallbackConsent();
  const heroId = randomUUID();
  initial.data.profile.heroPortrait = '/api/media/' + heroId;
  initial.data.profile.privacy = 'Синтетическая политика, не для публикации.';
  initial.data.profile.terms = 'Синтетические условия, не для публикации.';
  initial.data.profile.socialLinks = { ...initial.data.profile.socialLinks, telegram: 'https://t.me/synthetic_channel' };
  initial.data.profile.socialUrl = 'https://vk.com/synthetic';
  initial.data.bookingOccupancy = { syntheticPrivateMarker: 'must remain private' };
  await db.query('UPDATE content SET body=$1,version=19 WHERE id=$2', [JSON.stringify(initial.data), 'main']);
  await db.query('INSERT INTO content VALUES ($1,$2,$3)', ['marketing', '{"draft":"synthetic unpublished working text"}', 7]);
  await db.query('INSERT INTO media VALUES ($1,$2,$3,$4)', ['synthetic-file', 'text/plain', Buffer.from('synthetic media bytes').toString('base64'), 'synthetic.txt']);
  await db.query('INSERT INTO media VALUES ($1,$2,$3,$4)', [heroId, 'image/png', Buffer.from('synthetic hero bytes').toString('base64'), 'synthetic-hero.png']);
  await db.query('INSERT INTO sessions VALUES ($1,$2)', ['synthetic-session-identifier', Date.now() + 60000]);
  await db.query('INSERT INTO attempts VALUES ($1,$2,$3)', ['synthetic-attempt-identifier', 2, Date.now() + 60000]);
  const snapshot = async () => Object.fromEntries(await Promise.all(['content', 'media', 'sessions', 'attempts'].map(async table => [table, await db.query(`SELECT * FROM ${table} ORDER BY id`)])));
  const before = await snapshot();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { force: true, recursive: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const req = (path, body) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const publicHero = await req(initial.data.profile.heroPortrait);
  assert.equal(publicHero.status,200); assert.equal(await publicHero.text(),'synthetic hero bytes');
  assert.equal((await req('/api/media/' + randomUUID())).status,404);
  assert.equal((await (await req('/api/contact/config')).json()).enabled, false);
  assert.equal((await req('/api/contact/callback', {})).status, 503);
  assert.deepEqual(await snapshot(), before);
  // Enable only this disposable fixture, never an application or production env.
  process.env.CONTACT_CALLBACK_ENABLED = 'true';
  process.env.CONTACT_CALLBACK_DATA_APPROVED = 'true';
  const { callbackReleaseRevision } = await import('../server/callbacks.mjs');
  process.env.CONTACT_CALLBACK_RELEASE_VERSION = callbackReleaseRevision(initial.data.profile).version;
  const config = await (await req('/api/contact/config')).json();
  assert.equal(config.enabled, true);
  const payload = { phone: '+447700900001', consent: true, consentVersion: config.consentVersion, requestId: randomUUID(), website: '' };
  assert.equal((await req('/api/contact/callback', payload)).status, 201);
  assert.equal((await req('/api/contact/callback', payload)).status, 200);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.query('SELECT id FROM callback_requests')).length, 1);
  const published = await (await req('/api/content')).json();
  assert.equal(published.profile.terms, initial.data.profile.terms);
  assert.equal(published.profile.socialLinks.telegram, initial.data.profile.socialLinks.telegram);
  assert.equal(published.bookingOccupancy, undefined);
  assert.doesNotMatch(JSON.stringify(published), /447700900001|syntheticPrivateMarker|synthetic-session-identifier|unpublished working text/);
  assert.equal((await req('/api/admin/callbacks')).status, 401);
});
