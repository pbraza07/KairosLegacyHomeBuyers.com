# Verification results — September 12, 2026

## Passed

- `npm run build`: TypeScript checks, Vite production frontend, bundled Express server.
- `npm test`: **7 integration tests passed** against PGlite's PostgreSQL engine through a test-only adapter.
- Repeated migrations; persisted inquiry records queried after submission; correct 201/200 responses and no seller information in public responses.
- Required fields, email/ZIP formats, phone required for phone/text, explicit acknowledgment, honeypot, same-origin checks, bounded JSON bodies and rate limiting.
- Retry and concurrent identical-submission deduplication; conflict for a reused ID with different data.
- Unauthorized lead access denied; admin sign-in, cookie attributes, CSRF enforcement, content updates, stale-version conflict, invalid media rejection, deletion and logout.
- Database failure produces 503 and no successful-save message; missing email configuration is recorded separately; simulated email-provider failure preserves the lead and subsequent retry recovers.
- Startup migration is bundled into the server and runs idempotently before the app listens; background maintenance reports separate safe task codes for notification, rate cleanup, and session cleanup failures.
- Unique server-delivered SEO metadata, structured data, sitemap, robots exclusions and real 404 response.
- Live cloud-browser desktop inspection: logo and home image render; hero layout reviewed; navigation to FAQs works; accordion opens.
- Live cloud-browser offer flow: empty-field errors, property entry, back navigation, preserved entries, all three steps, checked acknowledgment and successful save confirmation.
- Escape dismisses the dialog and restores focus to its initiating CTA.
- Live cloud-browser contact form: synthetic test inquiry successfully saved and confirmation displayed.

## Included but not fully executed here

`tests/browser/site.spec.ts` contains automated desktop, mobile (390×844), tablet (768×1024), modal focus-loop, admin review and retry-state checks. The standalone browser runner could not download its Chromium binary in this environment. Desktop interaction was verified using the available cloud browser instead. Mobile/tablet viewport emulation and automated focus-loop/error-interception tests remain to run with:

```bash
npx playwright install chromium
npm run test:browser
```

Responsive breakpoints, visible focus styles, sticky-CTA clearance, reduced-motion support, semantic labels and Radix focus trapping are implemented, but this report does not claim completed real-device or full accessibility certification. Recheck on an actual phone/tablet before launch. The live desktop check caught a development HTTP compatibility issue in UUID generation; it was fixed with cryptographic `getRandomValues` and retested successfully.

## Live-service checks still required

- Actual Render deployment/Blueprint validation in the owner's account and managed PostgreSQL connectivity; the production database was not provisioned.
- Production HTTPS admin cookie, chosen domain/origin and proxy topology.
- Real Resend sender verification, API credentials and recipient inbox delivery; development tests sent no real messages.
- Real Turnstile keys/allowed hostnames if enabled.
- Provider backups and a restore exercise, privacy/retention approval, and final mobile/tablet QA.

## Scope notes

The editor changes structured page content, lists, metadata, brand colors and images. It is not a code editor or arbitrary drag-and-drop layout builder. Source changes are needed for new page types or substantially different layouts.

The original logo PNG is preserved; WebP/favicon derivatives are uncropped and proportional. The home image is fictional, AI-generated illustrative imagery, not an acquired property or testimonial.
