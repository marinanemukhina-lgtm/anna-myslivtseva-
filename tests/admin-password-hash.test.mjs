import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";

// All passwords in this file are synthetic compatibility fixtures.
async function generate(password) {
  const { generateAdminPasswordHash } = await import("../shared/admin-password-hash.mjs");
  return generateAdminPasswordHash(password);
}

for (const [name, password] of [
  ["ASCII", "synthetic-ASCII-password-123"],
  ["Unicode", "Синтетический-пароль-🌿-123"],
  ["unmodified whitespace and combining characters", "  synthetic-e\u0301-fixture  "],
  ["maximum accepted length", "x".repeat(256)],
]) {
  test(`browser hash matches the existing Node scrypt format for ${name}`, async () => {
    const value = await generate(password);
    assert.match(value, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
    const [salt, hash] = value.split(":");
    // Node's salt is the UTF-8 hex string, not the original 16 random bytes.
    assert.equal(hash, scryptSync(password, salt, 64).toString("hex"));
  });
}

test("each explicit generation uses a fresh 16-byte Web Crypto salt", async (t) => {
  const original = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const sizes = [];
  t.mock.method(globalThis.crypto, "getRandomValues", (bytes) => {
    sizes.push(bytes.byteLength);
    return original(bytes);
  });
  const first = await generate("synthetic-salt-fixture-123");
  const second = await generate("synthetic-salt-fixture-123");
  assert.deepEqual(sizes, [16, 16]);
  assert.notEqual(first.split(":")[0], second.split(":")[0]);
});

test("a password of 12 characters is accepted", async () => {
  assert.match(await generate("synthetic-12"), /^[a-f0-9]{32}:[a-f0-9]{128}$/);
});

test("invalid passwords are rejected before random generation", async (t) => {
  const random = t.mock.method(globalThis.crypto, "getRandomValues", () => {
    assert.fail("invalid input must not reach random generation");
  });
  for (const value of ["", "x".repeat(11), "x".repeat(257), null, undefined]) {
    await assert.rejects(generate(value), /12.*256/);
  }
  assert.equal(random.mock.callCount(), 0);
});

test("there is no weak random fallback when Web Crypto is unavailable", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    await assert.rejects(generate("synthetic-no-crypto-123"), /защищённом браузере/);
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});

test("insecure browser contexts are rejected", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
  Object.defineProperty(globalThis, "isSecureContext", { value: false, configurable: true });
  try {
    await assert.rejects(generate("synthetic-insecure-fixture"), /защищённом браузере/);
  } finally {
    if (original) Object.defineProperty(globalThis, "isSecureContext", original);
    else delete globalThis.isSecureContext;
  }
});
