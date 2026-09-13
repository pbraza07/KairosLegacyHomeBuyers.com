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

## Immediate recovery without waiting for the code update

If the current deployment still has the old commit, open Render **Shell** and run:

```bash
npm run migrate
```

If this returns a connection or authentication error, `DATABASE_URL` is wrong or the database is unavailable. Copy the Internal Database URL again from the Render PostgreSQL service and redeploy. Do not paste that URL into GitHub or chat.

Do not fix this by removing the startup database check or by editing `node_modules`. The former would allow an unhealthy deployment to appear live, and the latter is discarded on the next build.
