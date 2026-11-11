import { contactMethods } from "../src/contact-methods.mjs";

/** Match the existing CMS phone normalization; never invent a destination. */
export function phoneHref(phone) {
  const normalized = contactMethods({ phone }).phone;
  return normalized ? "tel:" + normalized : null;
}

export function safeDirectionsUrl(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 2000 || /[\s\\\u0000-\u001f\u007f]/.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password || url.port) return null;
    const labels = url.hostname.split(".");
    if (labels.length < 2 || labels.some(label =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
    )) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * officeAddress is an explicitly published premises address, NOT the site's
 * general city/home-visit blurb. This helper never reads profile.address or
 * constructs a map URL from an address.
 */
export function officeDirections(officeAddress, directionsUrl) {
  if (typeof officeAddress !== "string") return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(officeAddress)) return null;
  const address = officeAddress.trim().replace(/\s+/g, " ");
  if (!address || address.length > 500 || !/[a-zа-яё0-9]/i.test(address)) return null;
  const href = safeDirectionsUrl(directionsUrl);
  return { address, href };
}

// Default SMS is limited to the existing Russian mobile-number rule.
// Other numbers require an explicitly supplied, confirmed SMS destination.
export function smsHref(phone, explicitSmsPhone) {
  const target = explicitSmsPhone === undefined ? phoneHref(phone) : phoneHref(explicitSmsPhone);
  if (!target) return null;
  if (explicitSmsPhone === undefined && !/^tel:\+79\d{9}$/.test(target)) return null;
  return target.replace(/^tel:/, "sms:");
}
