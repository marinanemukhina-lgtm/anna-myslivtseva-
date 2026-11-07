import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scryptSync} from 'node:crypto';
import {contentSchema} from '../shared/content.mjs';
import {publicSocialLinks, updateSocialProfile} from '../shared/contact-links.mjs';

test('isolated authenticated CMS persists, replaces and clears social links while retaining unrelated content', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'anna-social-test-'));
  process.env.DATA_DIR = dir;
  process.env.ADMIN_PASSWORD_HASH = 'synthetic-salt:' + scryptSync('synthetic-password-only', 'synthetic-salt', 64).toString('hex');
  const {createApp} = await import('../server/app.mjs');
  const server = createApp().listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie = '';
  const request = (url, method='GET', body) => fetch(base+url,{method,headers:{origin:base,'content-type':'application/json',cookie},body:body === undefined ? undefined : JSON.stringify(body)});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  assert.equal((await request('/api/admin/content')).status,401);
  const login = await request('/api/session','POST',{password:'synthetic-password-only'});
  assert.equal(login.status,200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const initial = await (await request('/api/admin/content')).json();
  initial.data = contentSchema.parse(initial.data);
  for (const value of [' https://t.me/synthetic_channel ', 'https://t.me/synthetic_replaced', '', '']) {
    const current = await (await request('/api/admin/content')).json();
    const next = structuredClone(current);
    next.data.profile = updateSocialProfile(next.data.profile,'telegram',value);
    const saved = await request('/api/admin/content','PUT',next);
    assert.equal(saved.status,200);
    const reloaded = await (await request('/api/admin/content')).json();
    assert.equal(reloaded.data.profile.socialLinks.telegram,value.trim());
    for (const key of ['bookingSchedule','services','news','offers','diplomas']) assert.deepEqual(reloaded.data[key],initial.data[key]);
    for (const key of Object.keys(initial.data.profile).filter(key=>key !== 'socialLinks')) assert.deepEqual(reloaded.data.profile[key],initial.data.profile[key]);
    const published = await (await request('/api/content')).json();
    assert.equal(publicSocialLinks(published.profile).filter(x=>x.key === 'telegram').length,value.trim() ? 1 : 0);
    assert.equal((await request('/api/admin/content','PUT',next)).status,409);
  }
});
