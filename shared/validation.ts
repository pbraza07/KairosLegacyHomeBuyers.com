import { z } from "zod";
import { defaultContent } from "./content";
const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1, "This field is required.");
const numeric = (max: number) =>
  z
    .union([
      z.literal(""),
      z
        .string()
        .regex(/^\d+(\.\d+)?$/, "Enter a positive number.")
        .refine((v) => Number(v) <= max, `Must be at most ${max}.`),
    ])
    .default("");
export const propertySchema = z.object({
  street: required(200),
  city: required(100),
  state: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, "Select a state."),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code."),
  propertyType: z
    .enum([
      "",
      "Single-family",
      "Townhouse",
      "Condo",
      "Manufactured",
      "Multi-family",
      "Other",
    ])
    .default(""),
  bedrooms: numeric(100),
  bathrooms: numeric(100),
  sqft: numeric(1000000),
  yearBuilt: z
    .union([
      z.literal(""),
      z
        .string()
        .regex(/^\d{4}$/)
        .refine(
          (v) => +v >= 1700 && +v <= new Date().getFullYear() + 1,
          "Enter a valid year.",
        ),
    ])
    .default(""),
});
export const conditionSchema = z.object({
  condition: z
    .enum(["", "Updated", "Minor repairs", "Major repairs", "Unsure"])
    .default(""),
  occupancy: z
    .enum(["", "Owner occupied", "Tenant occupied", "Vacant", "Other"])
    .default(""),
  timeline: z
    .enum([
      "",
      "As soon as practical",
      "1–3 months",
      "3–6 months",
      "6+ months",
      "Just exploring",
    ])
    .default(""),
  askingPrice: numeric(1000000000),
  reason: text(1000).default(""),
  details: text(4000).default(""),
});
export const contactFields = {
  fullName: required(120),
  email: required(254).email("Enter a valid email address."),
  phone: text(30)
    .refine(
      (v) =>
        !v ||
        (/^[+()\d\s.-]{7,30}$/.test(v) && v.replace(/\D/g, "").length >= 10),
      "Enter a valid phone number.",
    )
    .default(""),
  preferred: z.enum(["Email", "Phone", "Text"]).default("Email"),
  acknowledgment: z.literal(true, {
    errorMap: () => ({ message: "Please acknowledge how we may respond." }),
  }),
};
const phoneRule = (
  v: { preferred: string; phone: string },
  ctx: z.RefinementCtx,
) => {
  if (v.preferred !== "Email" && !v.phone)
    ctx.addIssue({
      code: "custom",
      path: ["phone"],
      message: "Phone number is required for phone or text contact.",
    });
};
export const contactStepSchema = z.object(contactFields).superRefine(phoneRule);
export const offerSchema = propertySchema
  .merge(conditionSchema)
  .extend(contactFields)
  .strict()
  .superRefine(phoneRule);
export const messageSchema = z
  .object({ ...contactFields, message: required(4000) })
  .strict()
  .superRefine(phoneRule);
export const envelopeSchema = z
  .object({
    id: z.string().uuid(),
    trap: text(200),
    token: text(4000),
    data: z.unknown(),
  })
  .strict();
export const loginSchema = z
  .object({ email: required(254).email(), password: required(256) })
  .strict();
// All public content is plain text; never evaluated or rendered as raw HTML.
function schemaFor(value: unknown): z.ZodTypeAny {
  if (typeof value === "string") return z.string().max(12000);
  if (Array.isArray(value)) {
    return z
      .array(
        value.length
          ? schemaFor(value[0])
          : z
              .object({ name: text(120), role: text(120), bio: text(2000) })
              .strict(),
      )
      .max(60);
  }
  return z
    .object(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          schemaFor(v),
        ]),
      ),
    )
    .strict();
}
export const contentSchema = schemaFor(defaultContent).superRefine((v, ctx) => {
  for (const k of ["forest", "gold", "ivory", "charcoal"])
    if (!/^#[0-9a-f]{6}$/i.test(v.theme[k]))
      ctx.addIssue({
        code: "custom",
        path: ["theme", k],
        message: "Use a six-digit hex color.",
      });
  for (const [path, url] of [
    ["logo", v.business.logo],
    ["image", v.home.image],
  ])
    if (
      !/^\/images\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|svg)$/.test(url) ||
      url.includes("..")
    )
      ctx.addIssue({
        code: "custom",
        path: [path],
        message: "Use a local /images/ asset path.",
      });
  if (!z.string().email().safeParse(v.business.email).success)
    ctx.addIssue({
      code: "custom",
      path: ["business", "email"],
      message: "A valid business email is required.",
    });
});
