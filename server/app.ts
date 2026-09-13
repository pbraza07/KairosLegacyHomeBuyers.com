import express from "express";
import helmet from "helmet";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "./db";
import { defaultContent, type SiteContent } from "../shared/content";
import {
  contentSchema,
  envelopeSchema,
  offerSchema,
  messageSchema,
  loginSchema,
} from "../shared/validation";
import {
  digest,
  originGuard,
  rateLimit,
  requireAdmin,
  passwordMatches,
} from "./security";

export async function getContent() {
  const r = await pool.query(
    "SELECT content,version FROM site_content WHERE id=1",
  );
  return r.rows[0] as { content: SiteContent; version: number };
}
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "https://challenges.cloudflare.com",
            ...(process.env.NODE_ENV === "production"
              ? []
              : ["'unsafe-inline'"]),
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'"],
          connectSrc: [
            "'self'",
            "https://challenges.cloudflare.com",
            ...(process.env.NODE_ENV === "production" ? [] : ["ws:"]),
          ],
          frameSrc: ["https://challenges.cloudflare.com"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      referrerPolicy: { policy: "no-referrer" },
      strictTransportSecurity:
        process.env.NODE_ENV === "production" ? undefined : false,
    }),
  );
  app.use("/api/admin/assets", express.json({ limit: "6mb" }));
  app.use(express.json({ limit: "128kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", originGuard);
  app.get("/healthz", async (_req, res) => {
    try {
      await pool.query("SELECT 1 FROM site_content WHERE id=1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.get("/api/content", async (_req, res) => {
    const { content } = await getContent();
    res.json({
      content,
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "",
    });
  });
  const submitLimit = rateLimit("submit", 12, 15);
  for (const kind of ["offer", "contact"] as const)
    app.post(`/api/${kind}`, submitLimit, async (req, res) => {
      const envelope = envelopeSchema.safeParse(req.body);
      if (!envelope.success)
        return void res
          .status(400)
          .json({ error: "Please check the form and try again." });
      const { id, trap, token } = envelope.data;
      if (trap)
        return void res
          .status(400)
          .json({ error: "Unable to submit. Please contact us directly." });
      const parsed = (kind === "offer" ? offerSchema : messageSchema).safeParse(
        envelope.data.data,
      );
      if (!parsed.success)
        return void res
          .status(422)
          .json({
            error: "Please check the highlighted information.",
            fields: parsed.error.flatten().fieldErrors,
          });
      const hash = digest(JSON.stringify({ kind, data: parsed.data }));
      // Look up successful retry before consuming a one-use CAPTCHA token.
      const prior = await pool.query(
        "SELECT payload_hash FROM inquiries WHERE id=$1",
        [id],
      );
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== hash)
          return void res
            .status(409)
            .json({
              error:
                "This request was already used. Please start a new inquiry.",
            });
        return void res.json({ saved: true });
      }
      if (process.env.TURNSTILE_SECRET_KEY) {
        try {
          const check = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
              method: "POST",
              body: new URLSearchParams({
                secret: process.env.TURNSTILE_SECRET_KEY,
                response: token,
              }),
              signal: AbortSignal.timeout(10000),
            },
          );
          const result = (await check.json()) as {
            success: boolean;
            hostname: string;
          };
          if (
            !result.success ||
            result.hostname !== new URL(process.env.APP_ORIGIN!).hostname
          )
            return void res
              .status(400)
              .json({
                error: "Please complete the spam-protection check again.",
              });
        } catch {
          return void res
            .status(503)
            .json({
              error:
                "Spam protection is temporarily unavailable. Please try again.",
            });
        }
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          hash,
        ]);
        const duplicate = await client.query(
          "SELECT id FROM inquiries WHERE payload_hash=$1 AND created_at>now()-interval '15 minutes' LIMIT 1",
          [hash],
        );
        if (duplicate.rowCount) {
          await client.query("COMMIT");
          return void res.json({ saved: true });
        }
        const inserted = await client.query(
          "INSERT INTO inquiries(id,kind,payload,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id",
          [id, kind, parsed.data, hash],
        );
        if (inserted.rowCount)
          await client.query(
            "INSERT INTO notifications(inquiry_id) VALUES($1)",
            [id],
          );
        else {
          const existing = await client.query(
            "SELECT payload_hash FROM inquiries WHERE id=$1",
            [id],
          );
          if (existing.rows[0].payload_hash !== hash) {
            await client.query("ROLLBACK");
            return void res
              .status(409)
              .json({
                error:
                  "This request was already used. Please start a new inquiry.",
              });
          }
        }
        await client.query("COMMIT");
        res.status(inserted.rowCount ? 201 : 200).json({ saved: true });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    });
  app.post("/api/admin/login", rateLimit("login", 5, 15), async (req, res) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success)
      return void res
        .status(400)
        .json({ error: "Enter your email and password." });
    const r = await pool.query(
      "SELECT id,password_hash FROM admins WHERE email=$1",
      [p.data.email.toLowerCase()],
    );
    const dummy = "a".repeat(32) + ":" + "0".repeat(128);
    const valid = await passwordMatches(
      p.data.password,
      r.rows[0]?.password_hash || dummy,
    );
    if (!r.rowCount || !valid)
      return void res
        .status(401)
        .json({ error: "Email or password was not recognized." });
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO admin_sessions(token_hash,admin_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
      [digest(token), r.rows[0].id, csrf],
    );
    res.cookie("kairos_admin", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 8 * 60 * 60 * 1000,
      path: "/api/admin",
    });
    res.json({ csrf });
  });
  app.use("/api/admin", requireAdmin);
  app.get("/api/admin/session", (_req, res) =>
    res.json({ csrf: res.locals.session.csrf }),
  );
  app.post("/api/admin/logout", async (_req, res) => {
    await pool.query("DELETE FROM admin_sessions WHERE token_hash=$1", [
      res.locals.session.tokenHash,
    ]);
    res.clearCookie("kairos_admin", { path: "/api/admin" });
    res.json({ ok: true });
  });
  app.post("/api/admin/assets", async (req, res) => {
    if (typeof req.body.base64 !== "string" || req.body.base64.length > 5600000)
      return void res
        .status(400)
        .json({ error: "Choose an image smaller than 4 MB." });
    let bytes: Buffer;
    try {
      const input = Buffer.from(req.body.base64, "base64");
      const meta = await sharp(input, {
        limitInputPixels: 25000000,
      }).metadata();
      if (!["png", "jpeg", "webp"].includes(meta.format || ""))
        throw new Error();
      bytes = await sharp(input, { limitInputPixels: 25000000 })
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      return void res
        .status(400)
        .json({
          error: "Use a valid PNG, JPG, or WebP image, up to 25 megapixels.",
        });
    }
    const id = randomUUID();
    await pool.query("INSERT INTO image_assets(id,bytes) VALUES($1,$2)", [
      id,
      bytes,
    ]);
    res.status(201).json({ path: `/images/uploads/${id}.webp` });
  });
  app.get("/api/admin/content", async (_req, res) =>
    res.json(await getContent()),
  );
  app.put("/api/admin/content", async (req, res) => {
    const parsed = contentSchema.safeParse(req.body.content);
    if (!parsed.success)
      return void res
        .status(422)
        .json({
          error:
            "Some content is invalid. Check asset paths, email, color codes, and text lengths.",
          fields: parsed.error.flatten().fieldErrors,
        });
    if (!Number.isInteger(req.body.version))
      return void res.status(400).json({ error: "Refresh the editor." });
    const r = await pool.query(
      "UPDATE site_content SET content=$1,version=version+1,updated_at=now() WHERE id=1 AND version=$2 RETURNING version",
      [parsed.data, req.body.version],
    );
    if (!r.rowCount)
      return void res
        .status(409)
        .json({
          error:
            "Content changed in another session. Reload the editor before saving.",
        });
    res.json({ version: r.rows[0].version });
  });
  app.get("/api/admin/inquiries", async (req, res) => {
    const page = Math.max(0, Math.min(10000, Number(req.query.page) || 0));
    const r = await pool.query(
      "SELECT i.id,i.kind,i.payload,i.created_at,n.state AS notification_state,n.last_code FROM inquiries i LEFT JOIN notifications n ON n.inquiry_id=i.id ORDER BY i.created_at DESC LIMIT 26 OFFSET $1",
      [Math.floor(page) * 25],
    );
    res.json({ items: r.rows.slice(0, 25), hasMore: r.rows.length > 25 });
  });
  app.delete("/api/admin/inquiries/:id", async (req, res) => {
    if (!/^[\da-f-]{36}$/.test(String(req.params.id)))
      return void res.status(400).json({ error: "Invalid inquiry." });
    await pool.query("DELETE FROM inquiries WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  });
  app.post("/api/admin/retry-notifications", async (_req, res) => {
    await pool.query(
      "UPDATE notifications SET state='pending',attempts=0,next_attempt=now() WHERE state IN ('failed','disabled')",
    );
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.get("/images/uploads/:file", async (req, res) => {
    const match = /^([a-f0-9-]{36})\.webp$/.exec(String(req.params.file));
    if (!match) return void res.sendStatus(404);
    const r = await pool.query("SELECT bytes FROM image_assets WHERE id=$1", [
      match[1],
    ]);
    if (!r.rowCount) return void res.sendStatus(404);
    res
      .set("Cache-Control", "public,max-age=31536000,immutable")
      .type("image/webp")
      .send(r.rows[0].bytes);
  });
  app.get("/robots.txt", (_req, res) => {
    const origin = process.env.APP_ORIGIN || "";
    res
      .type("text")
      .send(
        `User-agent: *\nDisallow: /admin\nDisallow: /api/\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`,
      );
  });
  app.get("/sitemap.xml", (_req, res) => {
    const origin = process.env.APP_ORIGIN || "";
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/about", "/faqs", "/contact", "/offer", "/privacy"].map((path) => `<url><loc>${escape(origin + path)}</loc></url>`).join("")}</urlset>`,
      );
  });
  return app;
}
export async function attachFrontend(app: ReturnType<typeof createApp>) {
  const production = process.env.NODE_ENV === "production";
  let vite: any;
  if (production)
    app.use(
      express.static(resolve("dist/client"), { index: false, maxAge: "1h" }),
    );
  else {
    const { createServer } = await import("vite");
    vite = await createServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
  }
  app.use(async (req, res, next) => {
    if (req.method !== "GET") return next();
    try {
      const known: Record<string, string> = {
        "/": "home",
        "/about": "about",
        "/faqs": "faqs",
        "/contact": "contact",
        "/offer": "offer",
        "/privacy": "privacy",
        "/admin": "admin",
      };
      const key = known[req.path];
      if (!key && req.path.includes("."))
        return void res.status(404).send("Not found");
      let content = defaultContent;
      try {
        content = (await getContent()).content;
      } catch {
        /* Public pages remain readable during database outage; forms still fail honestly. */
      }
      const seo = content.seo[key as keyof typeof content.seo] || {
        title:
          key === "admin"
            ? "Admin | Kairos Legacy Homes"
            : "Page not found | Kairos Legacy Homes",
        description: "Kairos Legacy Homes LLC",
      };
      const origin = process.env.APP_ORIGIN || "";
      const business = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: content.business.name,
        url: origin,
        foundingDate: content.business.founded,
        email: content.business.email,
        telephone: content.business.phone,
        areaServed: content.business.serviceAreas,
        logo: origin + content.business.logo,
      }).replace(/</g, "\\u003c");
      const meta = `<title>${escape(seo.title)}</title><meta name="description" content="${escape(seo.description)}"/><meta property="og:title" content="${escape(seo.title)}"/><meta property="og:description" content="${escape(seo.description)}"/><meta property="og:type" content="website"/><meta property="og:url" content="${escape(origin + req.path)}"/><meta property="og:image" content="${escape(origin + content.business.logo)}"/><meta name="twitter:card" content="summary"/><link rel="canonical" href="${escape(origin + req.path)}"/>${key === "admin" || !key ? '<meta name="robots" content="noindex,nofollow"/>' : ""}<script type="application/ld+json">${business}</script>`;
      let html = (
        await readFile(
          resolve(production ? "dist/client/index.html" : "index.html"),
          "utf8",
        )
      ).replace("<!--SEO-->", meta);
      if (!production) html = await vite.transformIndexHtml(req.path, html);
      res
        .status(key ? 200 : 404)
        .type("html")
        .send(html);
    } catch (e) {
      next(e);
    }
  });
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        err?.type === "entity.too.large"
          ? 413
          : err instanceof SyntaxError
            ? 400
            : 503;
      console.error(
        status === 503 ? "request_service_error" : "request_rejected",
      );
      res
        .status(status)
        .json({
          error:
            status === 413
              ? "The submitted information is too large. Please shorten your message."
              : status === 400
                ? "Invalid request. Please try again."
                : "We couldn’t confirm your submission. Your entries are still here—please try again or contact us directly.",
        });
    },
  );
}
