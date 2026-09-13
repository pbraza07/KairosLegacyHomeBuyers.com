import "dotenv/config";
import { createApp, attachFrontend } from "./app";
import { pool } from "./db";
import { migrate } from "./migrate";
import { processNotifications } from "./notifications";
if (
  !process.env.DATABASE_URL ||
  !process.env.APP_ORIGIN ||
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 32
)
  throw new Error(
    "DATABASE_URL, APP_ORIGIN and SESSION_SECRET (32+ characters) are required. See .env.example.",
  );
if (!!process.env.TURNSTILE_SITE_KEY !== !!process.env.TURNSTILE_SECRET_KEY)
  throw new Error("Configure both Turnstile keys or neither.");

// Keep startup safe for manually-created Render services where the Blueprint's
// preDeployCommand was not synced. This migration is idempotent and protected
// by a PostgreSQL advisory lock, so running it after a pre-deploy migration is
// harmless. If the database is unavailable, fail clearly before health checks
// begin instead of serving a partially initialized application.
try {
  await migrate();
  console.log("Kairos database ready.");
} catch (error) {
  const detail =
    error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown_database_error";
  console.error("database_migration_failed", detail);
  process.exitCode = 1;
  process.exit(1);
}

const app = createApp();
await attachFrontend(app);
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Kairos application ready."),
);
let working = false;
const tick = async () => {
  if (working) return;
  working = true;
  try {
    await processNotifications();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown_notification_error";
    console.error("notification_task_error", detail);
  }
  try {
    await pool.query("DELETE FROM rate_buckets WHERE expires_at<now()");
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown_rate_cleanup_error";
    console.error("rate_cleanup_error", detail);
  }
  try {
    await pool.query("DELETE FROM admin_sessions WHERE expires_at<now()");
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown_session_cleanup_error";
    console.error("session_cleanup_error", detail);
  } finally {
    working = false;
  }
};
const interval = setInterval(tick, 30000);
void tick();
async function stop() {
  clearInterval(interval);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
