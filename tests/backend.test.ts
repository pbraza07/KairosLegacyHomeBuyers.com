import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database";
import { migrate } from "../scripts/migrate";
import { createApp, attachFrontend } from "../server/app";
import { pool } from "../server/db";
import { passwordHash } from "../server/security";
import {
  processNotifications,
  setNotificationTransportForTests,
} from "../server/notifications";
import { defaultContent } from "../shared/content";
let cleanup: any, server: any, base: string;
const valid = {
  street: "123 Test Street",
  city: "Wesley Chapel",
  state: "FL",
  zip: "33545",
  fullName: "Test Seller",
  email: "seller@example.test",
  preferred: "Email",
  acknowledgment: true,
};
async function request(
  path: string,
  body?: any,
  headers: Record<string, string> = {},
  method?: string,
) {
  return fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
before(async () => {
  process.env.NODE_ENV = "production";
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.SESSION_SECRET = "test-only-session-secret-32-characters";
  cleanup = await testDatabase();
  await migrate();
  await migrate();
  const app = createApp();
  await attachFrontend(app);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await cleanup.close();
});
test("health, validation, private records, origin, honeypot and JSON limits", async () => {
  assert.equal((await request("/healthz")).status, 200);
  assert.equal((await request("/api/admin/inquiries")).status, 401);
  assert.equal(
    (
      await request("/api/offer", {
        id: randomUUID(),
        trap: "",
        token: "",
        data: { ...valid, zip: "bad" },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/api/offer", {
        id: randomUUID(),
        trap: "",
        token: "",
        data: { ...valid, preferred: "Text" },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/api/contact", {
        id: randomUUID(),
        trap: "",
        token: "",
        data: {
          fullName: "x",
          email: "x@example.test",
          acknowledgment: false,
          message: "hello",
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/api/offer", {
        id: randomUUID(),
        trap: "bot",
        token: "",
        data: valid,
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/api/offer", {}, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal(
    (await request("/api/contact", { big: "x".repeat(140000) })).status,
    413,
  );
});
test("durable lead save, retry/concurrent dedupe, no PII returned, notification disabled independently", async () => {
  const body = { id: randomUUID(), trap: "", token: "", data: valid };
  const first = await request("/api/offer", body);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { saved: true });
  assert.equal((await request("/api/offer", body)).status, 200);
  const parallel = await Promise.all([
    request("/api/offer", { ...body, id: randomUUID() }),
    request("/api/offer", { ...body, id: randomUUID() }),
  ]);
  assert.ok(parallel.every((r) => r.status === 200));
  const count = await pool.query("SELECT count(*) AS n FROM inquiries");
  assert.equal(Number(count.rows[0].n), 1);
  assert.equal(
    (
      await request("/api/offer", {
        ...body,
        data: { ...valid, city: "Tampa" },
      })
    ).status,
    409,
  );
  await processNotifications();
  const record = await pool.query(
    "SELECT i.payload,n.state FROM inquiries i JOIN notifications n ON n.inquiry_id=i.id",
  );
  assert.equal(record.rows[0].payload.street, valid.street);
  assert.equal(record.rows[0].state, "disabled");
});
test("contact saves and inquiry endpoint rate limits", async () => {
  const r = await request("/api/contact", {
    id: randomUUID(),
    trap: "",
    token: "",
    data: {
      fullName: "Contact Test",
      email: "contact@example.test",
      phone: "",
      preferred: "Email",
      acknowledgment: true,
      message: "Question about a property.",
    },
  });
  assert.equal(r.status, 201);
  let limited = false;
  for (let i = 0; i < 14; i++) {
    if (
      (
        await request("/api/contact", {
          id: randomUUID(),
          trap: "",
          token: "",
          data: {},
        })
      ).status === 429
    ) {
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
});
test("admin login, CSRF, content version guard, assets and private deletion", async () => {
  await pool.query(
    "INSERT INTO admins(id,email,password_hash) VALUES($1,$2,$3)",
    [
      randomUUID(),
      "admin@example.test",
      await passwordHash("long-secret-password"),
    ],
  );
  const login = await request("/api/admin/login", {
    email: "admin@example.test",
    password: "long-secret-password",
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  const { csrf } = await login.json();
  const headers = { Cookie: cookie.split(";")[0], "x-csrf-token": csrf };
  const current = await (
    await request("/api/admin/content", undefined, headers)
  ).json();
  assert.equal(
    (
      await request(
        "/api/admin/content",
        { content: defaultContent, version: current.version },
        { Cookie: headers.Cookie },
        "PUT",
      )
    ).status,
    403,
  );
  const changed = {
    ...defaultContent,
    home: { ...defaultContent.home, headline: "An edited headline." },
  };
  assert.equal(
    (
      await request(
        "/api/admin/content",
        { content: changed, version: current.version },
        headers,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/admin/content",
        { content: changed, version: current.version },
        headers,
        "PUT",
      )
    ).status,
    409,
  );
  assert.equal(
    (await (await request("/api/content")).json()).content.home.headline,
    "An edited headline.",
  );
  assert.equal(
    (
      await request(
        "/api/admin/assets",
        { base64: Buffer.from("<svg/>").toString("base64") },
        headers,
      )
    ).status,
    400,
  );
  const inquiries = await (
    await request("/api/admin/inquiries", undefined, headers)
  ).json();
  assert.equal(inquiries.items.length, 2);
  assert.equal(
    (
      await request(
        `/api/admin/inquiries/${inquiries.items[0].id}`,
        {},
        headers,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal((await request("/api/admin/logout", {}, headers)).status, 200);
  assert.equal(
    (await request("/api/admin/inquiries", undefined, headers)).status,
    401,
  );
});
test("SEO and 404 pages are served with correct status", async () => {
  const home = await request("/");
  const html = await home.text();
  assert.match(html, /Sell Your House for Cash in Tampa Bay/);
  assert.match(html, /application\/ld\+json/);
  assert.equal((await request("/not-a-page")).status, 404);
  assert.match(
    await (await request("/robots.txt")).text(),
    /Disallow: \/admin/,
  );
  assert.match(await (await request("/sitemap.xml")).text(), /\/offer/);
});
test("database failures return a retryable error and cannot report saved", async () => {
  await pool.query("DELETE FROM rate_buckets");
  const original = pool.connect;
  (pool as any).connect = async () => {
    throw new Error("synthetic storage failure");
  };
  try {
    const r = await request("/api/contact", {
      id: randomUUID(),
      trap: "",
      token: "",
      data: {
        fullName: "Outage Test",
        email: "outage@example.test",
        preferred: "Email",
        acknowledgment: true,
        message: "Must not succeed.",
      },
    });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).saved, undefined);
  } finally {
    pool.connect = original;
  }
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) AS n FROM inquiries WHERE payload->>'email'='outage@example.test'",
        )
      ).rows[0].n,
    ),
    0,
  );
});
test("notification provider failure is separate and retry can recover", async () => {
  process.env.GMAIL_SMTP_USER = "sender@example.test";
  process.env.GMAIL_SMTP_APP_PASSWORD = "test-app-password";
  process.env.NOTIFICATION_EMAIL = "inbox@example.test";
  await pool.query(
    "UPDATE notifications SET state='pending',attempts=0,next_attempt=now()",
  );
  setNotificationTransportForTests({
    sendMail: async () => {
      throw Object.assign(new Error("synthetic auth failure"), {
        code: "EAUTH",
      });
    },
  });
  try {
    await processNotifications();
    const failed = await pool.query("SELECT state FROM notifications");
    assert.ok(failed.rows.every((r) => r.state === "failed"));
    await pool.query("UPDATE notifications SET next_attempt=now()");
    setNotificationTransportForTests({
      sendMail: async (message: any) => {
        assert.ok(!String(message.text).includes("seller@example.test"));
        return { messageId: "synthetic-provider-id" } as any;
      },
    });
    await processNotifications();
    const sent = await pool.query("SELECT state FROM notifications");
    assert.ok(sent.rows.every((r) => r.state === "sent"));
  } finally {
    setNotificationTransportForTests(undefined);
    delete process.env.GMAIL_SMTP_USER;
    delete process.env.GMAIL_SMTP_APP_PASSWORD;
    delete process.env.NOTIFICATION_EMAIL;
  }
});
