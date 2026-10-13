import { z } from "zod";
const text = z.string().max(50000),
  short = z.string().max(500),
  id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const link = z
  .string()
  .max(2000)
  .refine(
    (s) => !s || /^https?:\/\/[^\s]+$/i.test(s),
    "Укажите ссылку, начинающуюся с https://",
  );
const media = z
  .string()
  .max(250)
  .refine(
    (s) =>
      !s || /^\/(?:media\/[a-zA-Z0-9_.-]+|api\/media\/[a-f0-9-]+)$/.test(s),
    "Некорректный файл",
  );
const base = {
  id,
  title: short,
  body: text,
  image: media,
  published: z.boolean(),
};
export const contentSchema = z.object({
  profile: z.object({
    name: short,
    role: short,
    tagline: short,
    intro: text,
    about: text,
    philosophy: text,
    approach: text,
    qualification: text,
    phone: short,
    email: z.union([z.literal(""), z.email()]),
    address: short,
    hours: text,
    bookingUrl: link,
    mapUrl: link,
    socialUrl: link,
    portrait: media,
    heroPosition: z.number().min(0).max(100),
    privacy: text,
    terms: text,
  }),
  services: z
    .array(
      z.object({
        ...base,
        price: z.string().max(100),
        duration: z.string().max(100),
        category: short,
      }),
    )
    .max(100),
  news: z.array(z.object({ ...base, date: z.string().max(30) })).max(200),
  offers: z
    .array(
      z.object({
        ...base,
        price: z.string().max(100),
        until: z.string().max(30),
        conditions: text,
      }),
    )
    .max(100),
  diplomas: z
    .array(
      z.object({
        ...base,
        issuer: short,
        year: z.string().max(10),
        fileType: z.enum(["image", "pdf"]).default("image"),
      }),
    )
    .max(100),
});
export const initialContent = {
  profile: {
    name: "Анна Мысливцева",
    role: "Остеопат",
    tagline: "Анна Мысливцева · Остеопат",
    intro: "",
    about: "",
    philosophy: "",
    approach: "",
    qualification: "",
    phone: "",
    email: "",
    address: "",
    hours: "",
    bookingUrl: "",
    mapUrl: "",
    socialUrl: "",
    portrait: "/media/anna-portrait.jpg",
    heroPosition: 0,
    privacy: "",
    terms: "",
  },
  services: [],
  news: [],
  offers: [],
  diplomas: [],
};
export function publicContent(data) {
  return {
    ...data,
    services: data.services.filter((x) => x.published),
    news: data.news.filter((x) => x.published),
    offers: data.offers.filter((x) => x.published),
    diplomas: data.diplomas.filter((x) => x.published),
  };
}
