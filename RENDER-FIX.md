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

Set `EMAIL_PROVIDER=gmail_api` for a Render Free service. This uses Gmail's
HTTPS API, so the notification still comes from Gmail without SMTP:

```text
EMAIL_PROVIDER=gmail_api
GMAIL_CLIENT_ID=your_google_oauth_client_id
GMAIL_CLIENT_SECRET=your_google_oauth_client_secret
GMAIL_REFRESH_TOKEN=your_google_oauth_refresh_token
GMAIL_API_USER=kairoslegacyhomes@gmail.com
NOTIFICATION_EMAIL=kairoslegacyhomes@gmail.com
```

Create the OAuth client and refresh token with the Gmail send scope
`https://www.googleapis.com/auth/gmail.send`. Google Cloud Console and OAuth
Playground can be used from a local computer; Render Shell is not required.
Keep the client secret and refresh token only in Render's server environment.

Only use Gmail SMTP on a paid Render plan that permits outbound SMTP:

```text
EMAIL_PROVIDER=gmail_smtp
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
Refresh **Seller inquiries** after deploying. Each new inquiry shows separate
`Email` and `Seller reply` statuses. A `sent` status means Gmail accepted that
message; check the business and seller inboxes, including Spam/Promotions.

## Immediate recovery without a shell

If a notification is already stuck in `sending`, deploy/restart the service and
wait five minutes. Then open `/admin` → **Seller inquiries** and click **Retry
email notifications**. The corrected route re-queues failed, disabled and stale
sending jobs. If the service shows `smtp_connection_error` on Render Free, set
`EMAIL_PROVIDER=gmail_api` and supply the OAuth variables; changing Gmail SMTP
credentials cannot bypass Render's SMTP port restriction.

Do not fix deployment errors by removing the startup database check or editing
`node_modules`. The former allows an unhealthy deployment to appear live, and
the latter is discarded on the next build.
