# Render recovery for `background_task_error`

The build warnings about `"use client"` are harmless Rollup notices. The fatal
runtime issue was different: an older deployed commit started the server before
its PostgreSQL migrations had run, then logged only the opaque
`background_task_error` message from the notification/cleanup loop.

The current source fixes this in two ways:

1. `server/migrate.ts` runs transactional, advisory-locked migrations before
   the HTTP server listens. This is safe to run after Render's
   `preDeployCommand`; migrations are idempotent.
2. Background jobs log `notification_task_error`, `rate_cleanup_error`, or
   `session_cleanup_error` with a bounded database error message instead of one
   generic label.

## Deploy the fix

1. Replace the repository contents with this corrected project, or copy the
   changed files.
2. Commit and push to the branch connected to Render:

```bash
git add .
git commit -m "Enable reliable Render email notifications"
git push origin main
```

3. In Render, confirm these variables exist under **Environment**:
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

Set `EMAIL_PROVIDER=resend` for a Render Free service. Render Free blocks
outbound SMTP ports 25, 465 and 587, so Gmail SMTP cannot work there. Configure
the Resend HTTPS API instead:

```text
EMAIL_PROVIDER=resend
RESEND_API_KEY=your_resend_api_key
NOTIFICATION_FROM=Kairos Legacy Homes <notifications@your-verified-domain.com>
NOTIFICATION_EMAIL=kairoslegacyhomes@gmail.com
```

`NOTIFICATION_FROM` must use a domain verified in Resend. For testing, Resend's
`onboarding@resend.dev` sender may be limited to the account's permitted test
recipient; use a domain you control before launch. The HTTPS transport has a
bounded timeout and an idempotency key, so it does not depend on SMTP ports.

Only use `EMAIL_PROVIDER=gmail` on a Render plan that permits outbound SMTP:

```text
EMAIL_PROVIDER=gmail
GMAIL_SMTP_USER=kairoslegacyhomes@gmail.com
GMAIL_SMTP_APP_PASSWORD=your_google_app_password
NOTIFICATION_EMAIL=kairoslegacyhomes@gmail.com
```

Create the Gmail App Password at <https://myaccount.google.com/apppasswords>;
never use the normal Gmail password or `ADMIN_PASSWORD`. If an App Password
was ever exposed in a screenshot, revoke it and create a new one.

After changing environment values, use **Save and deploy** (not Save only).
The worker marks a notification `sending` before delivery, uses timeouts, and
the admin retry action re-queues stale `sending` rows older than five minutes.
Refresh **Seller inquiries** after deploying. A `sent` status means the
provider accepted the message; check the provider dashboard and recipient
inbox for final delivery.

## Immediate recovery without a shell

If a notification is already stuck in `sending`, deploy/restart the service and
wait five minutes. Then open `/admin` → **Seller inquiries** and click **Retry
email notifications**. The corrected route re-queues failed, disabled and stale
sending jobs. If the service shows `smtp_connection_error` on Render Free, set
`EMAIL_PROVIDER=resend`; changing Gmail credentials cannot bypass Render's SMTP
port restriction.

Do not fix deployment errors by removing the startup database check or editing
`node_modules`. The former allows an unhealthy deployment to appear live, and
the latter is discarded on the next build.
