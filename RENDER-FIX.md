# Render recovery for `background_task_error`

The build warnings about `"use client"` are harmless Rollup notices. `vite.config.ts` now filters only that known warning. The fatal runtime issue was different: the old deployed commit started the server before its PostgreSQL migrations had run, then logged only the opaque `background_task_error` message from the notification/cleanup loop.

The current source fixes this in two ways:

1. `server/migrate.ts` runs the transactional, advisory-locked migrations before the HTTP server listens. This is safe to run after Render's `preDeployCommand`; migrations are idempotent.
2. Background jobs now log `notification_task_error`, `rate_cleanup_error`, or `session_cleanup_error` with a bounded database error message instead of one generic label.

## Deploy the fix

1. Replace the repository contents with this corrected project, or copy the changed files:
   - `.node-version`
   - `package.json`
   - `vite.config.ts`
   - `server/migrate.ts`
   - `server/index.ts`
   - `scripts/migrate.ts`
   - `README.md`
   - `VERIFICATION.md`
2. Commit and push to the branch connected to Render:

```bash
git add .
git commit -m "Run database migrations before startup"
git push origin main
```

3. In Render, open the web service and confirm these variables exist under **Environment**:
   - `DATABASE_URL`: the PostgreSQL **Internal Database URL**
   - `APP_ORIGIN`: exact HTTPS service URL, with no trailing slash
   - `SESSION_SECRET`: 32+ random characters
   - `NODE_ENV=production`
   - `TRUST_PROXY_HOPS=1`
4. Deploy the new commit. The start log should include:

```text
Kairos database ready.
Kairos application ready.
```

5. Open `/healthz`; it should return `{"status":"ok"}`.

## Email notification setup

The recipient address alone does not enable delivery. The Gmail SMTP transport
requires all three server-only variables below:

```text
GMAIL_SMTP_USER=kairoslegacyhomes@gmail.com
GMAIL_SMTP_APP_PASSWORD=your_google_app_password
NOTIFICATION_EMAIL=kairoslegacyhomes@gmail.com
```

Turn on 2-Step Verification for the Gmail account, then create an App Password
at <https://myaccount.google.com/apppasswords>. Use the generated App Password
as `GMAIL_SMTP_APP_PASSWORD`; never use the normal Google account password.
The server connects to `smtp.gmail.com` over TLS on port 465 and sends from the
authenticated `GMAIL_SMTP_USER`.

Add the variables in Render's **Environment** page, then choose **Save and
deploy** (or **Save, rebuild, and deploy**). **Save only** does not put new
values into the running process.

The notification worker runs after a lead is committed and checks every 30
seconds. A saved lead is therefore not proof that an email was delivered. Sign
in to `/admin` and inspect each inquiry's notification state:

- `disabled` / `missing_email_configuration`: one of the three SMTP variables is missing.
- `failed` / `smtp_auth_error`: the Gmail address or App Password is incorrect, expired, or not authorized.
- `failed` / `smtp_connection_error`: Gmail SMTP could not be reached; the job will retry.
- `failed` / `smtp_4xx` or `smtp_5xx`: Gmail rejected the message; check the account security settings.
- `sent`: Gmail accepted the SMTP message. Check Gmail's Sent, Spam, and Promotions folders.

The alert email intentionally contains only a secure `/admin` link; seller
personal information remains in the protected database and admin area.

## Immediate recovery without waiting for the code update

If the current deployment still has the old commit, open Render **Shell** and run:

```bash
npm run migrate
```

If this returns a connection or authentication error, `DATABASE_URL` is wrong or the database is unavailable. Copy the Internal Database URL again from the Render PostgreSQL service and redeploy. Do not paste that URL into GitHub or chat.

Do not fix this by removing the startup database check or by editing `node_modules`. The former would allow an unhealthy deployment to appear live, and the latter is discarded on the next build.
