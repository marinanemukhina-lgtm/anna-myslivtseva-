import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contactMethods } from "../src/contact-methods.mjs";
import { publicSocialLinks, safePublicUrl } from "../shared/contact-links.mjs";

const arrowSource = await readFile(new URL("../src/ArrowIcon.jsx", import.meta.url), "utf8");
const arrowCompiled = await transform(arrowSource.replace("import React from 'react';", "").replace("export default function ArrowIcon", "function ArrowIcon"), {loader: 'jsx'});
const ArrowIcon = new Function('React', arrowCompiled.code + ';return ArrowIcon;')(React);
const socialSource = await readFile(new URL("../src/SocialLinks.jsx", import.meta.url), "utf8");
const socialCompiled = await transform(socialSource.replace("import ArrowIcon from './ArrowIcon.jsx';", "").replace("import React from 'react';", "").replace("import { publicSocialLinks } from '../shared/contact-links.mjs';", "").replace("export default function SocialLinks", "function SocialLinks"), {loader: 'jsx'});
const SocialLinks = new Function('React', 'publicSocialLinks', 'ArrowIcon', socialCompiled.code + ';return SocialLinks;')(React, publicSocialLinks, ArrowIcon);
const source = await readFile(new URL("../src/ContactActions.jsx", import.meta.url), "utf8");
const transformed = await transform(source
  .replace('import React from "react";', "")
  .replace('import ArrowIcon from "./ArrowIcon.jsx";', "")
  .replace('import SocialLinks from "./SocialLinks.jsx";', "")
  .replace('import { publicSocialLinks, safePublicUrl } from "../shared/contact-links.mjs";', "")
  .replace('import { contactMethods } from "./contact-methods.mjs";', "")
  .replace('import "./contact.css";', "")
  .replace("export default function ContactActions", "function ContactActions"), { loader: "jsx" });
const ContactActions = new Function("React", "contactMethods", "SocialLinks", "publicSocialLinks", "safePublicUrl", "ArrowIcon", transformed.code + ";return ContactActions;")(React, contactMethods, SocialLinks, publicSocialLinks, safePublicUrl, ArrowIcon);
const render = (profile) => renderToStaticMarkup(React.createElement(ContactActions, { profile }));

test("direct contact component renders explicit phone and device SMS links from the supplied profile", () => {
  const html = render({ phone: "+7 (900) 000-00-01", name: "Анна" });
  assert.match(html, /href="tel:\+79000000001"/);
  assert.match(html, /href="sms:\+79000000001"/);
  assert.match(html, /Позвонить Анне/);
  assert.match(html, /Написать SMS/);
  assert.match(html, /Сообщение отправляете вы/);
  assert.ok(!html.includes("+79000000000"));
  assert.ok(!html.includes("?body="));
});

test("empty and invalid phone render no new links; landline renders only a call link", () => {
  for (const profile of [undefined, {}, { phone: " " }, { phone: "javascript:+79000000000" }]) {
    const html = render(profile);
    assert.ok(!html.includes('href="tel:'));
    assert.ok(!html.includes('href="sms:'));
    assert.match(html, /Телефон для связи пока не опубликован/);
  }
  const landline = render({ phone: "+7 (495) 000-00-00" });
  assert.match(landline, /href="tel:\+74950000000"/);
  assert.ok(!landline.includes('href="sms:'));
});

test("component has no form, collection, retry storage, request hooks or invented messaging service", () => {
  const html = render({ phone: "+79000000000" });
  assert.doesNotMatch(html, /<form|<input|<button|callback|Перезвоните|WhatsApp|Telegram|mailto:/i);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|useEffect|useState|\/api\//);
});

test("contact integration has one contact composition and no calendar placeholder", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const contact = app.slice(app.indexOf("function Contact()"), app.indexOf("function Legal("));
  assert.match(contact, /<ContactActions profile=\{p\} \/>/);
  assert.doesNotMatch(contact, /<Booking|<Contacts|contact-section/);
  assert.doesNotMatch(contact, /callback|fetch\s*\(/i);
});

test('published socials are explicit channel links, not personal chat promises', () => {
  const html = render({socialLinks:{telegram:'https://t.me/synthetic_anna', vk:'https://vk.com/synthetic'}});
  assert.match(html, /Канал в Telegram/);
  assert.match(html, /href="https:\/\/t.me\/synthetic_anna"/);
  assert.match(html, /noopener noreferrer/);
  assert.doesNotMatch(html, /Написать Анне|Личный чат/);
  assert.doesNotMatch(render({socialLinks:{telegram:'javascript:alert(1)'}}), /javascript:/);
});


test('contact composition preserves only published details and uses monochrome icons', () => {
  const html = render({phone:'+79000000001',email:'hello@example.invalid',address:'Тестовый адрес',hours:'Тестовые часы',mapUrl:'https://example.invalid/map',bookingUrl:'https://example.invalid/booking'});
  for (const text of ['Тестовый адрес','Тестовые часы','Место и формат приёма','Часы приёма','mailto:hello@example.invalid','https://example.invalid/map','https://example.invalid/booking']) assert.ok(html.includes(text));
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.ok(html.indexOf('Написать SMS') < html.indexOf('SMS откроется'));
  assert.ok(html.indexOf('SMS откроется') < html.indexOf('mailto:hello@example.invalid'));
  assert.doesNotMatch(html, /↗|Удобное время|Онлайн-календарь|>А\.<|>К\.<|>С\.<|>—</);
  const empty = render({});
  assert.doesNotMatch(empty, /contact-visit|Часы приёма|Место и формат приёма|<a\s/);
});
