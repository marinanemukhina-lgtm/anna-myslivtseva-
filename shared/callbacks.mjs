import { z } from "zod";

// This feature accepts a callback number only, never names or medical notes.
export const callbackConsentText = "Я соглашаюсь на обработку моего номера телефона для обратного звонка по моему запросу. Согласие не распространяется на рекламные сообщения.";
export const callbackPrivacyUrl = "/privacy";
export const callbackConsentUrl = "/callback-consent";
export const callbackDocumentDefaults = Object.freeze({ published: false, version: "", operatorName: "", operatorDetails: "", text: "" });
export const callbackDocumentSchema = z.object({
  published: z.boolean().default(false),
  version: z.string().max(100).default(""),
  operatorName: z.string().max(500).default(""),
  operatorDetails: z.string().max(5000).default(""),
  text: z.string().max(50000).default(""),
}).strict();

// Completeness/publication gate only, never proof of legal correctness or identity.
// Preserve exact owner-entered strings for the accepted immutable revision.
export function callbackDocument(profile) {
  const result = callbackDocumentSchema.safeParse(profile?.callbackConsent);
  if (!result.success || !result.data.published) return null;
  const doc = result.data;
  if (![doc.version, doc.operatorName, doc.operatorDetails, doc.text].every(value => value.trim())) return null;
  return doc;
}

export function callbackCheckboxText(doc) {
  return `Я соглашаюсь на обработку моего номера телефона для обратного звонка по моему запросу. Оператор: ${doc.operatorName}. Согласие не распространяется на рекламные сообщения.`;
}

export function callbackConsentSnapshot(profile) {
  const doc = callbackDocument(profile);
  if (!doc) return null;
  return Object.freeze({
    format: "anna-callback-consent/v2",
    documentVersion: doc.version,
    operatorName: doc.operatorName,
    operatorDetails: doc.operatorDetails,
    documentText: doc.text,
    checkboxText: callbackCheckboxText(doc),
  });
}

// Earlier immutable rows are plain checkbox text. Never rewrite or discard them.
export function readCallbackConsentSnapshot(text) {
  try {
    const value = JSON.parse(text);
    if (value?.format === "anna-callback-consent/v2") return value;
  } catch { /* Legacy text is still an exact readable snapshot. */ }
  return { format: "legacy-text", checkboxText: text };
}

export const callbackRetentionDays = 30;

// Structural validation, not proof that the number exists or belongs to its sender.
export function normalizeCallbackPhone(value) {
  if (typeof value !== "string" || value.length > 40) return null;
  const input = value.trim();
  if (!/^\+?[\d\s().-]+$/u.test(input) || /[\r\n\t]/.test(input)) return null;
  let digits = input.replace(/\D/g, "");
  if (!input.startsWith("+")) {
    if (/^8\d{10}$/.test(digits)) digits = `7${digits.slice(1)}`;
    else if (/^9\d{9}$/.test(digits)) digits = `7${digits}`;
    else if (!/^7\d{10}$/.test(digits)) return null;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  if (digits.startsWith("7") && !/^7[3-9]\d{9}$/.test(digits)) return null;
  if (/^(\d)\1+$/.test(digits)) return null;
  return `+${digits}`;
}

export const callbackIdSchema = z.string().uuid();
export const callbackPayloadSchema = z.object({
  phone: z.string().min(1).max(40).refine((value) => normalizeCallbackPhone(value) !== null),
  consent: z.literal(true),
  consentVersion: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: callbackIdSchema,
  website: z.literal(""),
}).strict();

export const callbackStatusSchema = z.object({
  status: z.enum(["new", "done"]),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
