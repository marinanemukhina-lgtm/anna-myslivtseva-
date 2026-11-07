import test from "node:test";
import assert from "node:assert/strict";
import { contactMethods } from "../src/contact-methods.mjs";

test("published Russian mobile produces tel and an explicit device SMS link", () => {
  for (const value of ["8 (900) 000-00-00", "+7 (900) 000-00-00", "79000000000"]) {
    assert.deepEqual(contactMethods({ phone: value }), { phone: "+79000000000", displayPhone: value, smsHref: "sms:+79000000000" });
  }
  assert.equal(contactMethods({ phone: " +7 900 000-00-00 " }).displayPhone, "+7 900 000-00-00");
});

test("empty, malformed, free-text and extension values never create new contact actions", () => {
  for (const phone of [undefined, null, 79000000000, "", "  ", "+000", "+70000000000", "javascript:+79000000000", "call +79000000000", "+79000000000 ext 2", "+7900\n0000000", "++79000000000", "+1234567890123456", "x".repeat(41)]) {
    const result = contactMethods({ phone });
    assert.equal(result.phone, "");
    assert.equal(result.smsHref, "");
  }
});

test("landline and international phones keep call links without guessing SMS capability", () => {
  assert.equal(contactMethods({ phone: "+7 (495) 000-00-00" }).phone, "+74950000000");
  assert.equal(contactMethods({ phone: "+7 (495) 000-00-00" }).smsHref, "");
  assert.equal(contactMethods({ phone: "+44 7700 900001" }).phone, "+447700900001");
  assert.equal(contactMethods({ phone: "+44 7700 900001" }).smsHref, "");
});

test("new actions depend only on published phone, never a default number or messenger account", () => {
  assert.deepEqual(contactMethods(), { phone: "", displayPhone: "", smsHref: "" });
  assert.deepEqual(contactMethods({ email: "owner@example.invalid", socialLinks: { telegram: "https://example.invalid" } }), contactMethods());
  assert.equal(contactMethods({ phone: "+7 900 000-00-01" }).smsHref, "sms:+79000000001");
});
