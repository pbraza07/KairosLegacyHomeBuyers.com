import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";
import { pool } from "./db";

// Outbox lives in the database. A crash or provider outage never loses the lead.
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
    });
    transportIdentity = identity;
  }
  return transport;
}

function classifyDeliveryError(error: unknown) {
  const e = error as { code?: unknown; responseCode?: unknown };
  const code = String(e.code || "");
  if (code === "EAUTH" || e.responseCode === 535) return "smtp_auth_error";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ENOTFOUND"].includes(code))
    return "smtp_connection_error";
  if (typeof e.responseCode === "number" && e.responseCode >= 400)
    return `smtp_${e.responseCode}`;
  return "smtp_delivery_error";
}

export async function processNotifications() {
  const smtpUser = process.env.GMAIL_SMTP_USER || "";
  const smtpAppPassword = process.env.GMAIL_SMTP_APP_PASSWORD || "";
  const recipient = process.env.NOTIFICATION_EMAIL || "";
  const missing = [
    ["GMAIL_SMTP_USER", smtpUser],
    ["GMAIL_SMTP_APP_PASSWORD", smtpAppPassword],
    ["NOTIFICATION_EMAIL", recipient],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const configurationState = missing.length
    ? `missing:${missing.join(",")}`
    : "ready";
  if (configurationState !== lastConfigurationState) {
    lastConfigurationState = configurationState;
    if (missing.length)
      console.error("notification_configuration_missing", missing.join(","));
    else console.log("notification_configuration_ready");
  }
  if (missing.length) {
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
  const mailer = getTransport(smtpUser, smtpAppPassword);
  for (const row of r.rows) {
    try {
      const message: SendMailOptions = {
        // Gmail SMTP should send from the authenticated Gmail account. Do not
        // use the seller's email address or an unverified From address here.
        from: smtpUser,
        to: recipient,
        subject: "New Kairos website inquiry",
        text: `A new inquiry has been saved. Sign in securely to review it: ${process.env.APP_ORIGIN}/admin\n\nSeller information is available only in your admin area.`,
      };
      await mailer.sendMail(message);
      await pool.query(
        "UPDATE notifications SET state='sent',last_code=NULL,updated_at=now() WHERE inquiry_id=$1",
        [row.inquiry_id],
      );
    } catch (error) {
      await pool.query(
        "UPDATE notifications SET state='failed',last_code=$2,next_attempt=now()+($3*interval '1 minute'),updated_at=now() WHERE inquiry_id=$1",
        [
          row.inquiry_id,
          classifyDeliveryError(error),
          Math.min(60, 2 ** row.attempts),
        ],
      );
    }
  }
}
