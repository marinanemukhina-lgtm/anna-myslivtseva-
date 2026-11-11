import test from "node:test";
import assert from "node:assert/strict";
import { phoneHref, safeDirectionsUrl, officeDirections, smsHref } from "../shared/contact-ui-links.mjs";

const phones = [
  ["formatted international phone", "+7 (908) 502-38-53", "tel:+79085023853"],
  ["different CMS phone", "+44 20 7946 0958", "tel:+442079460958"],
  ["NBSP formatting", "+7\u00a0(908)\u00a0502-38-53", "tel:+79085023853"],
  ["blank", "", null], ["unpublished", undefined, null], ["null", null, null],
  ["whitespace only", "  ", null], ["unsafe scheme", "javascript:alert(1)", null],
  ["letters", "+7abc9085023853", null], ["extension", "+7 908 5023853 ext 2", null],
  ["existing CMS Russian 8 format", "8 908 502-38-53", "tel:+79085023853"],
  ["existing CMS Russian 7 format", "79085023853", "tel:+79085023853"],
  ["too short", "+1234567", null], ["too long", "+1234567890123456", null],
];
for (const [name, input, expected] of phones) test("phone: " + name, () => assert.equal(phoneHref(input), expected));

const urls = [
  ["public map", "https://yandex.ru/maps/", "https://yandex.ru/maps/"],
  ["blank", "", null], ["unpublished", undefined, null], ["unsafe", "javascript:alert(1)", null], ["HTTP is not permitted", "http://example.org/", null],
  ["data URL", "data:text/html,hello", null], ["credential URL", "https://user:secret@example.org/", null],
  ["nonstandard port", "https://example.org:8443/", null], ["local host", "https://localhost/", null],
  ["empty hostname labels", "https://example..org/", null], ["spaces", "https://example.org/a b", null],
  ["backslash", "https://example.org\\evil", null],
];
for (const [name, input, expected] of urls) test("directions URL: " + name, () => assert.equal(safeDirectionsUrl(input), expected));

test("address is required, absent or invalid URL hides only the link", () => {
  assert.equal(officeDirections("", "https://yandex.ru/maps/"), null);
  assert.deepEqual(officeDirections("Тестовый адрес", ""), { address: "Тестовый адрес", href: null });
  assert.deepEqual(officeDirections("Тестовый адрес", "javascript:alert(1)"), { address: "Тестовый адрес", href: null });
});
test("no placeholder address", () => {
  for (const value of ["", " ", "—", "...", "\u0000bad"]) assert.equal(officeDirections(value, "https://yandex.ru/maps/"), null);
});
test("explicit synthetic address is returned as text, not a generated URL", () => {
  assert.deepEqual(officeDirections("  Тестовый адрес\nдля unit-теста  ", "https://yandex.ru/maps/"), {
    address: "Тестовый адрес для unit-теста", href: "https://yandex.ru/maps/",
  });
});
test("current city/home-visit blurb is never implicitly consumed", () => {
  const currentProfile = { address: "Ростов-на-Дону. Выезд на дом по предварительной записи.", mapUrl: "" };
  assert.equal(officeDirections(currentProfile.officeAddress, currentProfile.mapUrl), null);
});

test("SMS defaults only to a published Russian mobile", () => {
  assert.equal(smsHref("+7 (908) 502-38-53"), "sms:+79085023853");
  assert.equal(smsHref("+7 (495) 000-00-00"), null);
  assert.equal(smsHref("+44 20 7946 0958"), null);
  assert.equal(smsHref(""), null);
});
test("SMS supports an explicit confirmed destination without guessing other channels", () => {
  assert.equal(smsHref("+7 (495) 000-00-00", "+44 20 7946 0958"), "sms:+442079460958");
  assert.equal(smsHref("+7 (908) 502-38-53", null), null);
  assert.equal(smsHref("+7 (908) 502-38-53", "invalid"), null);
});
