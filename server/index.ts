import "dotenv/config";
import { createApp, attachFrontend } from "./app";
import { pool } from "./db";
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
    await pool.query("DELETE FROM rate_buckets WHERE expires_at<now()");
    await pool.query("DELETE FROM admin_sessions WHERE expires_at<now()");
  } catch {
    console.error("background_task_error");
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
