import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Match scripts/setup.mjs and the existing Node verifier exactly. In particular,
// scrypt receives the UTF-8 salt hex string, not the original random salt bytes.
export async function generateAdminPasswordHash(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new Error("Нужно от 12 до 256 символов.");
  }
  if (globalThis.isSecureContext === false || !globalThis.crypto?.getRandomValues) {
    throw new Error("Откройте страницу в защищённом браузере по HTTPS.");
  }
  const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToHex(saltBytes);
  const passwordBytes = new TextEncoder().encode(password);
  const saltTextBytes = new TextEncoder().encode(salt);
  let derived;
  try {
    derived = await scryptAsync(passwordBytes, saltTextBytes, {
      N: 16384,
      r: 8,
      p: 1,
      dkLen: 64,
      asyncTick: 8,
      maxmem: 32 * 1024 * 1024,
    });
    return `${salt}:${bytesToHex(derived)}`;
  } finally {
    // Best effort for owned byte arrays only. JavaScript strings, React/browser
    // internals and the clipboard cannot be reliably erased from memory here.
    passwordBytes.fill(0);
    saltTextBytes.fill(0);
    saltBytes.fill(0);
    derived?.fill(0);
  }
}
