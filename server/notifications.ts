import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";
import { pool } from "./db";

// Notifications are stored in PostgreSQL before delivery is attempted. The
// worker can therefore retry a provider failure without losing the inquiry.
let lastConfigurationState = "";
let transport: NotificationTransport | undefined;
let transportIdentity = "";
let testTransport: NotificationTransport | undefined;
let testFetch: typeof fetch | undefined;
let gmailTokenCache:
  | { identity: string; accessToken: string; expiresAt: number }
  | undefined;

export type NotificationTransport = Pick<Transporter, "sendMail">;

// Test-only dependency injection keeps integration tests offline. Production
// reads the server-side EMAIL_PROVIDER setting only; the browser can never
// select a transport or provide credentials.
export function setNotificationTransportForTests(
  value: NotificationTransport | undefined,
) {
  testTransport = value;
  transport = undefined;
  transportIdentity = "";
}

/** Test-only HTTP dependency injection. Production always uses global fetch. */
export function setNotificationFetchForTests(value: typeof fetch | undefined) {
  testFetch = value;
  gmailTokenCache = undefined;
}

function httpFetch(input: string | URL, init?: RequestInit) {
  return (testFetch || fetch)(input, init);
}

function getTransport(user: string, appPassword: string): NotificationTransport {
  if (testTransport) return testTransport;
  const identity = `${user}\u0000${appPassword}`;
  if (!transport || identity !== transportIdentity) {
    transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass: appPassword },
      // Do not leave a database row in `sending` indefinitely when an SMTP
      // connection is blocked by a network/provider problem.
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    transportIdentity = identity;
  }
  return transport;
}

function classifyDeliveryError(error: unknown) {
  const e = error as { code?: unknown; responseCode?: unknown };
  if (
    error instanceof Error &&
    /^(?:resend|gmail_api)(?:_token)?(?:_\d+|_[a-z_]+)$/.test(error.message)
  )
    return error.message;
  const code = String(e.code || "");
  if (code === "EAUTH" || e.responseCode === 535) return "smtp_auth_error";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ENOTFOUND"].includes(code))
    return "smtp_connection_error";
  if (typeof e.responseCode === "number" && e.responseCode >= 400)
    return `smtp_${e.responseCode}`;
  return "smtp_delivery_error";
}

type NotificationProvider =
  | { kind: "resend"; apiKey: string; from: string; recipient: string }
  | {
      kind: "gmail_api";
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      user: string;
      recipient: string;
    }
  | {
      kind: "gmail_smtp";
      user: string;
      appPassword: string;
      recipient: string;
    };

function getProvider(): NotificationProvider | null {
  const mode = (process.env.EMAIL_PROVIDER || "auto").trim().toLowerCase();
  const recipient = (process.env.NOTIFICATION_EMAIL || "").trim();
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  const resendFrom = (process.env.NOTIFICATION_FROM || "").trim();
  const gmailClientId = (process.env.GMAIL_CLIENT_ID || "").trim();
  const gmailClientSecret = (process.env.GMAIL_CLIENT_SECRET || "").trim();
  const gmailRefreshToken = (process.env.GMAIL_REFRESH_TOKEN || "").trim();
  const gmailApiUser =
    (process.env.GMAIL_API_USER || process.env.GMAIL_SMTP_USER || "").trim();
  const gmailUser = (process.env.GMAIL_SMTP_USER || "").trim();
  // Google displays App Passwords with spaces in some screens. They are not
  // part of the credential and removing whitespace makes pasting robust.
  const gmailPassword = (process.env.GMAIL_SMTP_APP_PASSWORD || "").replace(
    /\s/g,
    "",
  );

  const gmailApiReady =
    gmailClientId && gmailClientSecret && gmailRefreshToken && gmailApiUser;
  const gmailSmtpReady = gmailUser && gmailPassword;

  // Resend remains an explicit backwards-compatible option, but `auto` never
  // silently selects it. The Gmail deployment should remain Gmail even if an
  // old Resend key is still present in Render's environment.
  if (mode === "resend") {
    if (resendKey && resendFrom && recipient)
      return {
        kind: "resend",
        apiKey: resendKey,
        from: resendFrom,
        recipient,
      };
    return null;
  }

  // `gmail` is intentionally an alias for the Gmail API when OAuth settings
  // are present. This lets existing deployments change transports without
  // accidentally falling back to blocked SMTP on Render Free.
  if (
    mode === "gmail_api" ||
    (mode === "gmail" && gmailApiReady) ||
    (mode === "auto" && gmailApiReady)
  ) {
    if (gmailApiReady && recipient)
      return {
        kind: "gmail_api",
        clientId: gmailClientId,
        clientSecret: gmailClientSecret,
        refreshToken: gmailRefreshToken,
        user: gmailApiUser,
        recipient,
      };
    return null;
  }

  if (
    mode === "gmail_smtp" ||
    (mode === "gmail" && !gmailApiReady) ||
    (mode === "auto" && gmailSmtpReady)
  ) {
    if (gmailSmtpReady && recipient)
      return {
        kind: "gmail_smtp",
        user: gmailUser,
        appPassword: gmailPassword,
        recipient,
      };
    return null;
  }
  return null;
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function gmailAccessToken(provider: Extract<NotificationProvider, { kind: "gmail_api" }>) {
  const identity = `${provider.clientId}\u0000${provider.clientSecret}\u0000${provider.refreshToken}`;
  if (gmailTokenCache && gmailTokenCache.identity === identity && gmailTokenCache.expiresAt > Date.now() + 60_000)
    return gmailTokenCache.accessToken;

  let response: Response;
  try {
    response = await httpFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        refresh_token: provider.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("gmail_api_token_connection_error");
  }
  if (!response.ok) throw new Error(`gmail_api_token_${response.status}`);
  const data = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== "string" || !data.access_token)
    throw new Error("gmail_api_token_invalid");
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  gmailTokenCache = {
    identity,
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return data.access_token;
}

async function sendGmailApi(
  provider: Extract<NotificationProvider, { kind: "gmail_api" }>,
  inquiryId: string,
  text: string,
) {
  const accessToken = await gmailAccessToken(provider);
  const raw = [
    `From: ${provider.user}`,
    `To: ${provider.recipient}`,
    "Subject: New Kairos website inquiry",
    `X-Kairos-Inquiry-ID: ${inquiryId}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
  let response: Response;
  try {
    response = await httpFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: base64Url(raw) }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new Error("gmail_api_connection_error");
  }
  if (!response.ok) throw new Error(`gmail_api_${response.status}`);
}

export async function processNotifications() {
  const provider = getProvider();
  const mode = (process.env.EMAIL_PROVIDER || "auto").trim().toLowerCase();
  const configurationState = provider
    ? `ready:${provider.kind}`
    : `missing:${mode}`;
  if (configurationState !== lastConfigurationState) {
    lastConfigurationState = configurationState;
    if (provider)
      console.log("notification_configuration_ready", provider.kind);
    else
      console.error(
        "notification_configuration_missing",
        mode === "gmail_smtp"
          ? "GMAIL_SMTP_USER,GMAIL_SMTP_APP_PASSWORD,NOTIFICATION_EMAIL"
          : mode === "gmail" || mode === "gmail_api"
            ? "GMAIL_CLIENT_ID,GMAIL_CLIENT_SECRET,GMAIL_REFRESH_TOKEN,GMAIL_API_USER,NOTIFICATION_EMAIL"
            : mode === "resend"
              ? "RESEND_API_KEY,NOTIFICATION_FROM,NOTIFICATION_EMAIL"
              : "GMAIL_CLIENT_ID,GMAIL_CLIENT_SECRET,GMAIL_REFRESH_TOKEN,GMAIL_API_USER,NOTIFICATION_EMAIL",
      );
  }
  if (!provider) {
    await pool.query(
      "UPDATE notifications SET state='disabled',last_code='missing_email_configuration' WHERE state='pending'",
    );
    return;
  }
  await pool.query(
    "UPDATE notifications SET state='pending' WHERE state='disabled'",
  );
  const r = await pool.query(
    `UPDATE notifications SET state='sending', attempts=attempts+1,updated_at=now() WHERE inquiry_id IN (SELECT inquiry_id FROM notifications WHERE ((state IN ('pending','failed') AND next_attempt<=now() AND attempts<6) OR (state='sending' AND updated_at<now()-interval '5 minutes')) ORDER BY next_attempt FOR UPDATE SKIP LOCKED LIMIT 5) RETURNING inquiry_id,attempts`,
  );
  const mailer =
    provider.kind === "gmail_smtp"
      ? getTransport(provider.user, provider.appPassword)
      : undefined;
  for (const row of r.rows) {
    try {
      const text = `A new inquiry has been saved. Sign in securely to review it: ${process.env.APP_ORIGIN}/admin\n\nSeller information is available only in your admin area.`;
      if (provider.kind === "resend") {
        const response = await httpFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `inquiry-${row.inquiry_id}`,
          },
          body: JSON.stringify({
            from: provider.from,
            to: [provider.recipient],
            subject: "New Kairos website inquiry",
            text,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`resend_${response.status}`);
      } else if (provider.kind === "gmail_api") {
        await sendGmailApi(provider, row.inquiry_id, text);
      } else {
        const message: SendMailOptions = {
          // Send from the authenticated Gmail account. Do not use the seller's
          // email address or an unverified From address.
          from: provider.user,
          to: provider.recipient,
          subject: "New Kairos website inquiry",
          text,
        };
        await mailer!.sendMail(message);
      }
      await pool.query(
        "UPDATE notifications SET state='sent',last_code=NULL,updated_at=now() WHERE inquiry_id=$1",
        [row.inquiry_id],
      );
    } catch (error) {
      const code = classifyDeliveryError(error);
      // Keep logs free of message bodies, addresses and credentials. The
      // diagnostic code is also visible to the admin through the API.
      console.error("notification_delivery_failed", code);
      await pool.query(
        "UPDATE notifications SET state='failed',last_code=$2,next_attempt=now()+($3*interval '1 minute'),updated_at=now() WHERE inquiry_id=$1",
        [row.inquiry_id, code, Math.min(60, 2 ** row.attempts)],
      );
    }
  }
}
