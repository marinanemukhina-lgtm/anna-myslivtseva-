import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contactMethods } from "../src/contact-methods.mjs";

const source = await readFile(new URL("../src/ContactActions.jsx", import.meta.url), "utf8");
const transformed = await transform(source
  .replace('import React from "react";', "")
  .replace('import { contactMethods } from "./contact-methods.mjs";', "")
  .replace('import "./contact.css";', "")
  .replace("export default function ContactActions", "function ContactActions"), { loader: "jsx" });
const ContactActions = new Function("React", "contactMethods", transformed.code + ";return ContactActions;")(React, contactMethods);
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
