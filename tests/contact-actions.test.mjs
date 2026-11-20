import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contactMethods } from "../src/contact-methods.mjs";
import { publicSocialLinks } from "../shared/contact-links.mjs";

const socialSource = await readFile(new URL("../src/SocialLinks.jsx", import.meta.url), "utf8");
const socialCompiled = await transform(socialSource.replace("import React from 'react';", "").replace("import { publicSocialLinks } from '../shared/contact-links.mjs';", "").replace("export default function SocialLinks", "function SocialLinks"), {loader: 'jsx'});
const SocialLinks = new Function('React', 'publicSocialLinks', socialCompiled.code + ';return SocialLinks;')(React, publicSocialLinks);
const source = await readFile(new URL("../src/ContactActions.jsx", import.meta.url), "utf8");
const transformed = await transform(source
  .replace('import React from "react";', "")
  .replace('import SocialLinks from "./SocialLinks.jsx";', "")
  .replace('import { publicSocialLinks } from "../shared/contact-links.mjs";', "")
  .replace('import { contactMethods } from "./contact-methods.mjs";', "")
  .replace('import "./contact.css";', "")
  .replace("export default function ContactActions", "function ContactActions"), { loader: "jsx" });
const ContactActions = new Function("React", "contactMethods", "SocialLinks", "publicSocialLinks", transformed.code + ";return ContactActions;")(React, contactMethods, SocialLinks, publicSocialLinks);
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

test("contact integration keeps Booking and backend separation intact", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const contact = app.slice(app.indexOf("function Contact()"), app.indexOf("function Legal("));
  assert.match(contact, /<ContactActions profile=\{p\} \/>\s*<Booking profile=\{p\} \/>/);
  assert.match(contact, /<Contacts profile=\{p\} \/>/);
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

const questionsSource = await readFile(new URL("../src/ContactQuestions.jsx", import.meta.url), "utf8");
const questionsCompiled = await transform(questionsSource, { loader: "jsx", format: "cjs" });
const faqModule = { exports: {} };
new Function("require", "module", "exports", questionsCompiled.code)((name) => {
  switch (name) {
    case "react": return React;
    case "./contact-methods.mjs": return { contactMethods };
    default: throw new Error("Unexpected module: " + name);
  }
}, faqModule, faqModule.exports);
const renderQuestions = (data = {}) => renderToStaticMarkup(React.createElement(faqModule.exports.default, {
  data,
  Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children),
}));

test("visitor questions use published contact details, known location and supported actions", () => {
  const html = renderQuestions({
    profile: { phone: "+7 (900) 000-00-01", address: "Ростов-на-Дону. Выезд на дом по предварительной записи." },
    services: [{ published: true, price: "5000 ₽" }],
    diplomas: [{ published: true, title: "Документ из CMS" }],
  });
  assert.match(html, /<details><summary>Как записаться/);
  assert.match(html, /href="#contact-title"/);
  assert.match(html, /позвоните Анне или напишите SMS/);
  assert.doesNotMatch(html, /href="(?:tel:|sms:)|79000000001/);
  assert.match(html, /Выезд на дом в Ростове-на-Дону возможен по предварительной записи/);
  assert.match(html, /href="\/services"/);
  assert.match(html, /href="\/diplomas"/);
  assert.doesNotMatch(html, /<form|<input|5000 ₽|Документ из CMS|\/api\//);
});

test("visitor questions omit unsupported contact methods and distinguish empty or unpublished data", () => {
  const empty = renderQuestions({
    profile: { phone: "javascript:invalid", address: "Другой город", bookingUrl: "https://example.test" },
    services: [{ published: false, price: "5000 ₽" }],
    diplomas: [{ published: false, title: "Личный документ" }],
  });
  assert.doesNotMatch(empty, /href="(?:tel:|sms:)|Ростов-на-Дону|Выезд на дом|5000 ₽|Личный документ|example.test/);
  assert.match(empty, /Посмотрите доступные способы связи/);
  assert.match(empty, /href="\/services"/);
  assert.match(empty, /href="\/diplomas"/);
  assert.doesNotMatch(empty, /пока не опубликован/);
  const partial = renderQuestions({
    profile: { phone: "+74950000000", address: "Ростов-на-Дону." },
    services: [{ published: true, price: " " }, { published: false, price: "5000 ₽" }],
  });
  assert.match(partial, /позвоните Анне/);
  assert.doesNotMatch(partial, /напишите SMS|Выезд на дом|74950000000/);
  assert.match(partial, /Если цена опубликована/);
});

test("visitor questions live on the existing contact route without a new collection flow", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const contact = app.slice(app.indexOf("function Contact()"), app.indexOf("function Legal("));
  assert.match(contact, /<ContactQuestions data=\{data\} Link=\{Link\} \/>/);
  assert.doesNotMatch(questionsSource, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\/api\//);
});
