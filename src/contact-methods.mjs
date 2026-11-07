// Only published owner-supplied destinations. Never infer messenger accounts.
export function contactMethods(profile = {}) {
  const raw = String(profile.phone || "").trim();
  let digits = raw.replace(/[^\d+]/g, "");
  if (/^8\d{10}$/.test(digits)) digits = "+7" + digits.slice(1);
  if (/^7\d{10}$/.test(digits)) digits = "+" + digits;
  const phone = /^\+[1-9]\d{6,14}$/.test(digits) ? digits : "";
  const messages = [];
  for (const [key, label] of [["telegram", "Telegram"], ["whatsapp", "WhatsApp"], ["max", "MAX"], ["vk", "ВКонтакте"]]) {
    const href = String(profile.socialLinks?.[key] || "").trim();
    if (/^https?:\/\/[^\s]+$/i.test(href)) messages.push({ label: "Открыть " + label, href, external: true });
  }
  const email = String(profile.email || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) messages.push({ label: "Написать на почту", href: "mailto:" + email });
  // The published Russian mobile number can open the visitor's SMS application.
  // This is not a claim that WhatsApp/Telegram is registered on that number.
  if (/^\+79\d{9}$/.test(phone)) messages.push({ label: "Написать SMS", href: "sms:" + phone });
  return { phone, displayPhone: raw, messages };
}
