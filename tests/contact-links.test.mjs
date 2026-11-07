import test from 'node:test';
import assert from 'node:assert/strict';
import { safePublicUrl, socialLink, publicSocialLinks } from '../shared/contact-links.mjs';
import { contentSchema, initialContent } from '../shared/content.mjs';

test('social destinations require the matching HTTPS host and a page path', () => {
  for (const value of ['', null, 'javascript:alert(1)', 'https://t.me.evil.test/anna', 'https://evil.test/t.me/anna', 'https://user:pass@t.me/anna', 'https://t.me', 'http://t.me/anna', 'https://t.me:444/anna', 'https://t.me/ann a', 'https://t.me/anna\\x']) assert.equal(socialLink('telegram', value), '');
  assert.equal(socialLink('telegram', ' https://t.me/synthetic_anna '), 'https://t.me/synthetic_anna');
  assert.equal(socialLink('vk', 'https://www.vk.com/synthetic'), 'https://www.vk.com/synthetic');
  assert.equal(safePublicUrl('https://example.invalid/path?q=1'), 'https://example.invalid/path?q=1');
});
test('old primary and structured links survive together, hide empty values, and deduplicate', () => {
  assert.deepEqual(publicSocialLinks(), []);
  const profile = {socialUrl: 'https://t.me/synthetic_anna/', socialLinks:{telegram:'https://t.me/synthetic_anna', vk:'https://vk.com/synthetic', max:'javascript:alert(1)'}};
  assert.deepEqual(publicSocialLinks(profile).map(x=>x.key), ['telegram','vk']);
  assert.equal(publicSocialLinks({socialUrl:'https://t.me/synthetic_anna'})[0].label, 'Канал в Telegram');
  assert.equal(publicSocialLinks({socialUrl:'https://example.invalid/page'})[0].label, 'Социальная сеть Анны');
  assert.equal(publicSocialLinks({socialUrl:'https://user:secret@example.invalid/page'}).length, 0);
});
test('CMS round trip preserves old profile, services, calendar and all social fields', () => {
  const data = structuredClone(initialContent);
  data.profile.socialUrl = 'https://example.invalid/old';
  data.profile.socialLinks = {telegram:'https://t.me/synthetic_anna',vk:'https://vk.com/synthetic',max:'',instagram:'',whatsapp:''};
  data.bookingSchedule = contentSchema.parse(data).bookingSchedule;
  const before = structuredClone(data);
  const parsed = contentSchema.parse(data);
  assert.deepEqual(parsed.profile, before.profile);
  assert.deepEqual(parsed.services, before.services);
  assert.deepEqual(parsed.bookingSchedule, before.bookingSchedule);
  assert.deepEqual(parsed.news, before.news);
  assert.deepEqual(parsed.offers, before.offers);
  assert.deepEqual(parsed.diplomas, before.diplomas);
});

test('clearing and replacing a channel removes only its matching legacy duplicate', async () => {
  const {updateSocialProfile} = await import('../shared/contact-links.mjs');
  const original = {phone:'+79000000001', socialUrl:'https://t.me/synthetic/', socialLinks:{telegram:'https://t.me/synthetic', vk:'https://vk.com/synthetic'}};
  const cleared = updateSocialProfile(original, 'telegram', '');
  assert.equal(cleared.socialUrl, '');
  assert.equal(cleared.phone, original.phone);
  assert.deepEqual(publicSocialLinks(cleared).map(x=>x.key), ['vk']);
  assert.equal(original.socialLinks.telegram, 'https://t.me/synthetic');
  const independent = {...original, socialUrl:'https://example.invalid/legacy'};
  assert.equal(updateSocialProfile(independent, 'telegram', '').socialUrl, independent.socialUrl);
});

test('server contact fallback uses the same validated destinations', async () => {
  const {renderPublicPage} = await import('../server/public-pages.mjs');
  const data = structuredClone(initialContent);
  data.profile.phone = '8 (900) 000-00-01';
  data.profile.socialLinks = {telegram:'https://t.me/synthetic'};
  const {html} = renderPublicPage('<title>x</title><div id="root"></div>', '/contact', data);
  assert.match(html, /href="tel:\+79000000001"/);
  assert.match(html, /href="sms:\+79000000001"/);
  assert.match(html, /Канал в Telegram/);
});

test('channel URLs reject personal-phone, invite, utility and action routes, including legacy fallback', () => {
  for (const value of ['https://t.me/+79000000001','https://t.me/share/url?url=https://example.invalid','https://t.me/proxy?server=x','https://t.me/login','https://t.me/joinchat/abc','https://t.me/s/channel','https://t.me/synthetic?start=x','http://t.me/synthetic','https://t.me/']) {
    assert.equal(socialLink('telegram', value), '');
    assert.deepEqual(publicSocialLinks({socialUrl:value}), []);
  }
  assert.equal(socialLink('instagram','https://instagram.com/accounts/login'), '');
  assert.equal(socialLink('vk','https://vk.com/login'), '');
  assert.equal(socialLink('whatsapp','https://wa.me/79000000001'), 'https://wa.me/79000000001');
});

test('Telegram alias and username case deduplicate and clear; pasted whitespace roundtrips', async () => {
  const {updateSocialProfile} = await import('../shared/contact-links.mjs');
  const profile = {...initialContent.profile, socialUrl:'https://telegram.me/synthetic_channel/',socialLinks:{telegram:'https://t.me/Synthetic_Channel'}};
  assert.equal(publicSocialLinks(profile).length, 1);
  const removed = updateSocialProfile(profile,'telegram','');
  assert.deepEqual(publicSocialLinks(removed), []);
  assert.deepEqual(publicSocialLinks(updateSocialProfile(removed,'telegram','')), []);
  const data = structuredClone(initialContent);
  data.profile = updateSocialProfile(data.profile,'telegram','  https://t.me/synthetic_channel  ');
  assert.equal(contentSchema.parse(data).profile.socialLinks.telegram,'https://t.me/synthetic_channel');
});


test('WhatsApp API link has exactly one unambiguous phone parameter', () => {
  const base = 'https://api.whatsapp.com/send';
  assert.equal(socialLink('whatsapp', base + '?phone=79000000001'), base + '?phone=79000000001');
  for (const query of ['', '?phone=79000000001&phone=123', '?phone=79000000001&phone=79000000001', '?phone=79000000001&text=hello', '?other=79000000001']) {
    assert.equal(socialLink('whatsapp', base + query), '');
    assert.deepEqual(publicSocialLinks({socialUrl:base + query}), []);
  }
});
