// Use only the published phone. This does not discover messenger accounts or send messages.
export function contactMethods(profile = {}) {
  const displayPhone = typeof profile.phone === "string" ? profile.phone.trim() : "";
  const unavailable = { phone: "", displayPhone, smsHref: "" };
  if (!displayPhone || displayPhone.length > 40 || !/^\+?[\d \u00a0().-]+$/.test(displayPhone)) return unavailable;
  let digits = displayPhone.replace(/[^\d+]/g, "");
  if (/^8\d{10}$/.test(digits)) digits = "+7" + digits.slice(1);
  else if (/^7\d{10}$/.test(digits)) digits = "+" + digits;
  if (!/^\+[1-9]\d{7,14}$/.test(digits)) return unavailable;
  if (digits.startsWith("+7") && !/^\+7[3-9]\d{9}$/.test(digits)) return unavailable;
  return { phone: digits, displayPhone, smsHref: /^\+79\d{9}$/.test(digits) ? "sms:" + digits : "" };
}
