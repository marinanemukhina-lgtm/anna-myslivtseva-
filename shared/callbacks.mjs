import { z } from "zod";

// This feature accepts a callback number only, never names or medical notes.
export const callbackConsentText = "Я соглашаюсь на обработку моего номера телефона для обратного звонка по моему запросу. Согласие не распространяется на рекламные сообщения.";
export const callbackPrivacyUrl = "/privacy";
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
