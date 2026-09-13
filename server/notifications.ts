import { pool } from "./db";
// Outbox lives in the database. A crash or provider outage never loses the lead.
export async function processNotifications() {
  const configured = !!(
    process.env.RESEND_API_KEY &&
    process.env.NOTIFICATION_FROM &&
    process.env.NOTIFICATION_EMAIL
  );
  if (!configured) {
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
  for (const row of r.rows) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `inquiry-${row.inquiry_id}`,
        },
        body: JSON.stringify({
          from: process.env.NOTIFICATION_FROM,
          to: [process.env.NOTIFICATION_EMAIL],
          subject: "New Kairos website inquiry",
          text: `A new inquiry has been saved. Sign in securely to review it: ${process.env.APP_ORIGIN}/admin\n\nSeller information is available only in your admin area.`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`provider_${response.status}`);
      await pool.query(
        "UPDATE notifications SET state='sent',last_code=NULL,updated_at=now() WHERE inquiry_id=$1",
        [row.inquiry_id],
      );
    } catch (e) {
      const code =
        e instanceof Error && /^provider_\d+$/.test(e.message)
          ? e.message
          : "notification_transport_error";
      await pool.query(
        "UPDATE notifications SET state='failed',last_code=$2,next_attempt=now()+($3*interval '1 minute'),updated_at=now() WHERE inquiry_id=$1",
        [row.inquiry_id, code, Math.min(60, 2 ** row.attempts)],
      );
    }
  }
}
