import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";
import { pool } from "./db";

// Notifications are stored in PostgreSQL before delivery is attempted. The
// worker can therefore retry a provider failure without losing the inquiry.
let lastConfigurationState = "";
let transport: NotificationTransport | undefined;
let transportIdentity = "";
let testTransport: NotificationTransport | undefined;

export type NotificationTransport = Pick<Transporter, "sendMail">;

// Test-only dependency injection keeps integration tests offline. Production
// always uses Gmail SMTP and never reads a browser-provided mail setting.
export function setNotificationTransportForTests(
  value: NotificationTransport | undefined,
) {
  testTransport = value;
  transport = undefined;
  transportIdentity = "";
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
  if (error instanceof Error && /^resend_\d+$/.test(error.message))
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
      kind: "gmail";
      user: string;
      appPassword: string;
      recipient: string;
    };

function getProvider(): NotificationProvider | null {
  const mode = (process.env.EMAIL_PROVIDER || "auto").trim().toLowerCase();
  const recipient = (process.env.NOTIFICATION_EMAIL || "").trim();
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  const resendFrom = (process.env.NOTIFICATION_FROM || "").trim();
  const gmailUser = (process.env.GMAIL_SMTP_USER || "").trim();
  // Google displays App Passwords with spaces in some screens. They are not
  // part of the credential and removing whitespace makes pasting robust.
  const gmailPassword = (process.env.GMAIL_SMTP_APP_PASSWORD || "").replace(
    /\s/g,
    "",
  );

  if (mode === "resend" || (mode === "auto" && resendKey && resendFrom)) {
    if (resendKey && resendFrom && recipient)
      return {
        kind: "resend",
        apiKey: resendKey,
        from: resendFrom,
        recipient,
      };
    return null;
  }
  if (mode === "gmail" || (mode === "auto" && gmailUser && gmailPassword)) {
    if (gmailUser && gmailPassword && recipient)
      return {
        kind: "gmail",
        user: gmailUser,
        appPassword: gmailPassword,
        recipient,
      };
    return null;
  }
  return null;
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
        mode === "gmail"
          ? "GMAIL_SMTP_USER,GMAIL_SMTP_APP_PASSWORD,NOTIFICATION_EMAIL"
          : "RESEND_API_KEY,NOTIFICATION_FROM,NOTIFICATION_EMAIL",
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
    provider.kind === "gmail"
      ? getTransport(provider.user, provider.appPassword)
      : undefined;
  for (const row of r.rows) {
    try {
      const text = `A new inquiry has been saved. Sign in securely to review it: ${process.env.APP_ORIGIN}/admin\n\nSeller information is available only in your admin area.`;
      if (provider.kind === "resend") {
        const response = await fetch("https://api.resend.com/emails", {
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
