# Kairos Legacy Homes LLC

A complete React + Vite / Express TypeScript website for Tampa Bay homeowners requesting a cash-offer review. PostgreSQL stores leads, content, sessions, notification jobs, rate-limit buckets, and uploaded images. One Render web service serves both frontend and API.

## Included

- Home, About Us, FAQs, Contact, `/offer`, `/privacy`, and protected `/admin`.
- Original supplied green-and-gold logo; an illustrative Florida home image with provenance in `ASSETS.md`.
- Accessible offer modal (Radix Dialog), shared three-step form, state preservation across steps and modal dismissal, keyboard focus management, and mobile sticky CTA.
- Contact form with real server validation and storage. Neither form calculates an offer.
- Admin login, full structured content editor, repeatable items, page metadata, theme colors, logo/hero image uploads, private inquiry review, deletion, and notification retry.
- Durable database-backed content: editing a seed file never overwrites previously saved admin changes. Migration defaults are inserted only once.
- Resend notification outbox with retries. Messages contain a link to `/admin`, not seller information. No email integration runs in the browser.
- Database migrations, health check, Render Blueprint, local PostgreSQL Docker Compose, test suite, and environment example.

## Local setup

Use Node 22.12+ (Node 22 LTS recommended), npm, and PostgreSQL 17+. Docker is optional if you already have a PostgreSQL instance.

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

Privately set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 16 characters in `.env` or the environment. Do not put your password into source code, GitHub, a command argument, or a shared chat.

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

Blueprint syntax and current plan identifiers were checked against [Render's Blueprint reference](https://render.com/docs/blueprint-spec). If your account offers different plan labels, select equivalent paid web/Postgres plans in the dashboard; keep the build, start, health and database wiring above.

## Email notifications

Set all of these in Render's **server environment**:

- `RESEND_API_KEY`: private Resend API key with send permission.
- `NOTIFICATION_FROM`: a sender at a domain verified in Resend, such as `Kairos Legacy Homes <notifications@YOUR-VERIFIED-DOMAIN>` (replace with your real verified sender).
- `NOTIFICATION_EMAIL`: defaults to the supplied `kairoslegacyhomes@gmail.com`; can be another business inbox.

A Gmail inbox can receive messages; it is not automatically a verified sending domain. Never use an unverified Gmail address as `NOTIFICATION_FROM` and assume delivery works. This implementation uses [Resend's HTTPS email API](https://resend.com/docs/api-reference/emails/send-email), not SMTP or a browser email client.

After a successful database transaction, the outbox processor checks for notifications every 30 seconds. Missing configuration marks notification status **disabled**. Configured delivery retries with increasing delays, up to six attempts; failures stay visible in admin and can be retried there. The worker uses database row locking and a provider idempotency key. Stale in-flight jobs can resume after a process crash. A notification failure does not change a saved inquiry into an error for the homeowner.

**sent** means the provider accepted the API request; inbox delivery/bounce confirmation is not implemented. Verify the provider dashboard and recipient inbox during launch testing. Old disabled jobs become eligible when credentials are configured, so delete test inquiries before enabling notifications if you do not want their alerts. No real emails were sent during development verification.

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
- Verified notification sender domain, Resend API key, and confirmation of the notification inbox.
- Optional Turnstile keys and registered hostname.
- Approved Privacy Policy, business retention/deletion procedure, and chosen backup settings.
- Review the supplied phone `(813) 699-9316`, email `kairoslegacyhomes@gmail.com`, service areas, and family/veteran ownership wording. These are already populated, not missing placeholders.
- Confirm the illustrative hero image is acceptable, or replace it with an owned/licensed real photograph using the admin editor.

**Deployment status:** source is complete and buildable. No GitHub push, Render service, managed production database, domain, production admin account, or live notification delivery has been created or verified in your accounts.

For an isolated synthetic browser preview without a PostgreSQL server, explicitly set `KAIROS_TEST_PREVIEW=true` only in a private local `.env`, then use `npm run dev`. This mode uses disposable test data and a test account; it is forbidden when `NODE_ENV=production`. Remove the flag after QA. It is not a supported hosting mode or a substitute for the managed production database.
