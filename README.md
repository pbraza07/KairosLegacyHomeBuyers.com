# Kairos Legacy Homes LLC

A complete React + Vite / Express TypeScript website for Tampa Bay homeowners requesting a cash-offer review. PostgreSQL stores leads, content, sessions, notification jobs, rate-limit buckets, and uploaded images. One Render web service serves both frontend and API.

## Included

- Home, About Us, FAQs, Contact, `/offer`, `/privacy`, and protected `/admin`.
- Original supplied green-and-gold logo; an illustrative Florida home image with provenance in `ASSETS.md`.
- Accessible offer modal (Radix Dialog), shared three-step form, state preservation across steps and modal dismissal, keyboard focus management, and mobile sticky CTA.
- Contact form with real server validation and storage. Neither form calculates an offer.
- Admin login, full structured content editor, repeatable items, page metadata, theme colors, logo/hero image uploads, private inquiry review, deletion, and notification retry.
- Durable database-backed content: editing a seed file never overwrites previously saved admin changes. Migration defaults are inserted only once.
- Gmail API/Gmail SMTP notification outboxes with retries. The business message includes the submitted inquiry details and sets the seller email as `Reply-To`; a separate seller acknowledgement confirms receipt, includes the property address when available, promises a response within 24 hours, and routes replies back to Kairos. No email integration runs in the browser.
- Database migrations, health check, Render Blueprint, local PostgreSQL Docker Compose, test suite, and environment example.

## Local setup

Use Node 22.16.0 (pinned in `.node-version` and `package.json`), npm, and PostgreSQL 17+. Docker is optional if you already have a PostgreSQL instance. Pinning avoids Render silently moving an unbounded `>=22.12.0` range to a newer major version.

```bash
npm ci
cp .env.example .env
docker compose up -d
```

Set `DATABASE_URL` to the local PostgreSQL URL from `.env.example` or your own development database. Generate a session secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste it into your private `.env` as `SESSION_SECRET`. Then:

```bash
npm run migrate
npm run dev
```

Open `http://localhost:3000`. Use that exact origin (not `127.0.0.1`) because submissions validate Origin. The Vite middleware and API share this port. Normal development uses PostgreSQL, not an in-memory substitute.

### Create your admin account

Privately set `ADMIN_EMAIL` and a non-empty, unique `ADMIN_PASSWORD` in `.env` or the environment. A strong password is still recommended. Do not put your password into source code, GitHub, a command argument, or a shared chat.

```bash
npm run admin:create
```

Visit `/admin` and sign in. Remove `ADMIN_PASSWORD` from the environment after account creation. Running the command again resets that email's password and revokes its sessions. It stores a salted scrypt hash, not the password. There is no default production account or public registration. The credentials in browser tests are test-only and are never seeded by migrations or production startup.

### Production build locally

```bash
npm run build
```

For local HTTP checking, keep `NODE_ENV=development` and use `npm run dev`. A true production run requires HTTPS: set `NODE_ENV=production`, `APP_ORIGIN` to the HTTPS origin, and run `npm start`. Production cookies are Secure, HttpOnly, SameSite=Strict and scoped to `/api/admin`.

## GitHub setup

Create an empty **private** repository in your GitHub account, then run from the extracted project folder:

```bash
git init
git add .
git commit -m "Build Kairos Legacy Homes website"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the two repository placeholders with your actual account and repository. `.env`, dependencies, test results, builds, and local database data are ignored. `.env.example` intentionally contains no real credentials. Verify the staged files before committing. No GitHub repository has been created or pushed from this delivery.

## Render deployment

`render.yaml` declares a Node web service and managed PostgreSQL database in the same region, with public database access blocked. The Blueprint uses paid compute so the database and notification process are suitable for a durable deployment. Review Render's displayed pricing before creating resources; no resources have been created here.

1. Connect Render to your GitHub repository.
2. Choose **New → Blueprint** and select the repository containing `render.yaml`.
3. Set `APP_ORIGIN` to your intended HTTPS origin, without a trailing slash (for example your actual `https://...onrender.com` address). If Render assigns a different subdomain, update `APP_ORIGIN` immediately before testing forms. Do not use an example domain in production.
4. Render injects `DATABASE_URL` from the private managed database and generates `SESSION_SECRET`. The Blueprint installs development build tooling with `npm ci --include=dev`, builds the application, runs migrations before startup, and checks `/healthz`.
5. In the web service environment, temporarily set `ADMIN_EMAIL` and `ADMIN_PASSWORD`. In the Render service Shell, run `npm run admin:create`. Remove the password variable afterward. Alternatively run the command from a trusted local machine connected securely to your database; do not make database access public without a specific allowlist.
6. Configure notification credentials below and, optionally, Turnstile. Redeploy/restart when changing environment variables.
7. Sign in at `/admin`. Review all public copy and privacy text, confirm service areas, test a property inquiry and contact message, and verify both appear in **Seller inquiries**. Check notification status independently.
8. Add your domain in Render's custom-domain settings and apply its displayed DNS records at your registrar. Set `APP_ORIGIN` to that domain, update Turnstile allowed hostnames, and redeploy. Use one canonical origin; forms deliberately reject submissions from other origins. Redirect alternative domains to it.

Exact service settings:

| Setting      | Value                                           |
| ------------ | ----------------------------------------------- |
| Runtime      | Node                                            |
| Build        | `npm ci --include=dev && npm run build`         |
| Pre-deploy   | `npm run migrate`                               |
| Start        | `npm start`                                     |
| Health check | `/healthz`                                      |
| Database     | Managed PostgreSQL, internal connection URL     |
| Port         | Render's injected `PORT`                        |
| Proxy hops   | `TRUST_PROXY_HOPS=1` for Render's reverse proxy |

The health endpoint returns 503 if the database or content table is unavailable. The service will not start without a database URL, canonical origin, and strong session secret. Do not deploy `dist/client` as a standalone static site: it needs this backend. Migrations use a transaction, advisory lock and migration ledger; re-running is safe. There are no automatic destructive down-migrations. Back up before future schema changes.

The server also runs the same idempotent migrations immediately before it begins listening. This is a safety net for an existing manually-created Render Web Service whose Blueprint `preDeployCommand` was never synced. The configured Render pre-deploy migration should remain in place; running both is safe. A database connection or migration failure now stops startup with `database_migration_failed` instead of repeatedly logging an opaque background-task error.

Blueprint syntax and current plan identifiers were checked against [Render's Blueprint reference](https://render.com/docs/blueprint-spec). If your account offers different plan labels, select equivalent paid web/Postgres plans in the dashboard; keep the build, start, health and database wiring above.

## Email notifications

The notification outbox supports Gmail through the Gmail API over HTTPS. Set
`EMAIL_PROVIDER=gmail_api`; this works on Render Free and does not use Gmail
SMTP or an App Password.

Set these in Render's **server environment**:

- `GMAIL_CLIENT_ID`: OAuth client ID from Google Cloud.
- `GMAIL_CLIENT_SECRET`: matching OAuth client secret.
- `GMAIL_REFRESH_TOKEN`: OAuth refresh token with the
  `https://www.googleapis.com/auth/gmail.send` scope.
- `GMAIL_API_USER`: `kairoslegacyhomes@gmail.com`.
- `NOTIFICATION_EMAIL`: the destination inbox.

The server exchanges the refresh token for a short-lived access token, submits
a minimal notification through Gmail's HTTPS API, and caches the token in
memory. Tokens, credentials, seller data and message bodies never reach the
browser or routine logs.

### Creating Gmail API credentials (one time)

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project.
2. Enable **Gmail API** under **APIs & Services → Library**.
3. Configure the OAuth consent screen and add `kairoslegacyhomes@gmail.com` as a test user if the app is External.
4. Under **APIs & Services → Credentials**, create an OAuth client ID of type **Web application**. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI, then copy the client ID and secret.
5. In [Google OAuth Playground](https://developers.google.com/oauthplayground/), open the settings gear, select **Use your own OAuth credentials**, and enter those values.
6. Authorize `https://www.googleapis.com/auth/gmail.send` as `kairoslegacyhomes@gmail.com`, exchange the authorization code, and copy the refresh token into Render as `GMAIL_REFRESH_TOKEN`.
7. For production, publish/verify the OAuth consent screen as required by Google. Testing-mode refresh tokens can expire.

Never paste the client secret or refresh token into GitHub, the browser, or a
support chat. If a Gmail App Password was previously exposed, revoke it; this
provider does not use it.

### Gmail SMTP fallback (paid Render plans only)

`EMAIL_PROVIDER=gmail_smtp` remains available when the Render service permits
outbound SMTP. Set these variables:

- `GMAIL_SMTP_USER`: the Gmail account that sends the notification.
- `GMAIL_SMTP_APP_PASSWORD`: a Google App Password, not the normal Google password.
- `NOTIFICATION_EMAIL`: the destination inbox.

Gmail App Passwords require 2-Step Verification. Create one at
<https://myaccount.google.com/apppasswords> and paste the generated value
without spaces or quotation marks. Render Free blocks SMTP ports 25, 465 and
587, so Gmail SMTP cannot work on that plan.

After a successful database transaction, two independent outbox jobs are
created: one business alert and one seller acknowledgement. The processor
checks both queues every 30 seconds. Missing configuration marks both jobs
**disabled**. Configured delivery retries with increasing delays, up to six
attempts; failures stay visible in admin and can be retried there. Provider
timeouts prevent an item from remaining in **sending** forever, and the retry
button re-queues stale sending jobs. A notification failure does not change a
saved inquiry into an error for the homeowner.

**sent** means the provider accepted the message; inbox delivery/bounce
confirmation is not implemented. Check the provider dashboard and the
recipient's Spam, Promotions, Sent and All Mail folders during launch testing.
Business notification emails include the submitted contact/property details so
the business can respond quickly. The seller email is set as `Reply-To` on that
message. The seller acknowledgement says the request was received, repeats the
submitted property address when available, promises a response within 24 hours,
and sets the business inbox as `Reply-To`. Seller data remains protected from
public API responses, URLs and routine logs. Acknowledgements are only created
for new inquiries after the seller outbox migration; older inquiries are not
emailed automatically when this version is deployed.

## Spam protection and security

- All public form POSTs require same-origin JSON, bounded request bodies, a honeypot, shared client/server Zod schemas, and a database-backed rate limit (12 attempts per IP hash per 15 minutes).
- Admin login is limited to five attempts per IP hash per 15 minutes. Sessions expire after eight hours, use random tokens stored hashed server-side, and require a CSRF token for changes.
- Optional Turnstile: set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Register the canonical site's hostname in Cloudflare. The server verifies the token and returned hostname. Keys must be configured together; the secret stays server-side. Baseline honeypot/rate limiting works without it.
- UUID idempotency keys protect retries; identical normalized payloads are also deduplicated for 15 minutes under an advisory database lock. Different payloads may be submitted as a new inquiry. An ID already saved with different data returns 409.
- Only admins can read/delete submissions. Public responses contain no seller data. SQL uses parameters; errors and routine logs contain event codes, not bodies, addresses, emails, or raw IPs. Hosting providers may keep their own access logs.
- Rate-limit keyed IP hashes and expired admin sessions are removed by the periodic maintenance task. No public analytics, advertising pixels, or unrelated marketing subscription are installed. Form data lives only in React memory until submission or navigation away; it is not persisted in local storage or query strings.
- An admin can edit all configured copy, lists, metadata, brand colors, and images. The editor is deliberately structured, not an arbitrary HTML/code execution console. Layout/behavior changes beyond these controls require source edits. Recheck contrast if changing colors.
- Raster uploads are admin-only, limited to 4 MB / 25 megapixels, decoded and optimized using Sharp, and stored in PostgreSQL. They are public website assets: do not upload confidential documents. No seller uploads are collected.
- Use separate development and production databases. Choose and test provider backups, retention, and recovery before launch. No automated retention policy for leads is imposed; use admin deletion until a business-approved schedule is implemented.

## Editing business content

Initial content is in `shared/content.ts`. This includes the supplied phone/email, service areas, headings, FAQs, privacy draft, SEO and colors. On an existing database, use `/admin` to change values; seeds do not overwrite editor changes. Edits are version-checked to avoid silently overwriting another administrator's work.

Open a section in the editor, update fields or add/remove repeatable items, then **Save changes**. Save publishes the content immediately. Other already-open visitor tabs receive new content on refresh. Uploaded image paths can be pasted into **Home → Image** or **Business → Logo**. Update image alt text too. Team entries can be added under **About → Team**; the team section stays hidden until authentic entries are provided.

## Project structure

| Directory/file  | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `client/src`    | Public pages, forms, admin UI, responsive styles           |
| `server`        | Express routes, PostgreSQL access, security, notifications |
| `shared`        | Central content and validation schemas                     |
| `migrations`    | Ordered transactional SQL migrations                       |
| `scripts`       | Migration runner and admin provisioning                    |
| `public/images` | Supplied logo and illustrative home image                  |
| `tests`         | API integration and Playwright browser checks              |
| `render.yaml`   | Render web service and PostgreSQL blueprint                |
| `compose.yaml`  | Local PostgreSQL development service                       |
| `.env.example`  | Configuration names with no real secrets                   |

## Verification

```bash
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

`npm test` uses PGlite, the PostgreSQL engine compiled to WebAssembly, through a **test-only** adapter. Production always uses `pg` with the configured PostgreSQL server. Browser tests start an isolated test server and database with synthetic leads; never point that test server at a public deployment. The test account is present only in that isolated environment. See `VERIFICATION.md` for executed results and remaining live-service checks.

## Remaining launch inputs

- Your GitHub repository / Render account and selected paid plans.
- Final domain / canonical HTTPS origin.
- Your private admin email and strong password (the supplied business email may be used).
- Google Cloud OAuth client ID/secret, Gmail refresh token with the Gmail send scope, and confirmation of the notification inbox.
- Optional Turnstile keys and registered hostname.
- Approved Privacy Policy, business retention/deletion procedure, and chosen backup settings.
- Review the supplied phone `(813) 699-9316`, email `kairoslegacyhomes@gmail.com`, service areas, and family/veteran ownership wording. These are already populated, not missing placeholders.
- Confirm the illustrative hero image is acceptable, or replace it with an owned/licensed real photograph using the admin editor.

**Deployment status:** source is complete and buildable. No GitHub push, Render service, managed production database, domain, production admin account, or live notification delivery has been created or verified in your accounts.

For an isolated synthetic browser preview without a PostgreSQL server, explicitly set `KAIROS_TEST_PREVIEW=true` only in a private local `.env`, then use `npm run dev`. This mode uses disposable test data and a test account; it is forbidden when `NODE_ENV=production`. Remove the flag after QA. It is not a supported hosting mode or a substitute for the managed production database.
