# Little by little

A private, English-language schedule dashboard with live countdowns and custom progress bars.

Live application: https://little-by-little-aggre.pages.dev

Source download (same private Access login): https://little-by-little-aggre.pages.dev/little-by-little-source.zip. Every build packages the source, lockfile, and this deployment guide. No credentials or runtime database files are included.

## Features

- Create, edit, and delete events with a name, emoji, target date, and custom bar color.
- One-time events with a configurable progress start date.
- Repeat every N minutes, hours, days, weeks, months, or years.
- Event-specific IANA time zones; calendar repeats follow local daylight-saving rules.
- Monthly and yearly repeats stay anchored to their original date: January 31 becomes February 28, then March 31; February 29 returns in leap years.
- A repeating bar measures the previous occurrence to the next. At the deadline it restarts automatically. A future first target is preserved.
- Search, filters, sorting, completed-event toggle, JSON export, responsive layout, native accessible dialogs, reduced-motion support.
- Optional six everyday starter countdowns. No external fonts, analytics, or images.

## Stack

Astro 7.4.1, Svelte 5.57.2, @astrojs/svelte 9.1.0, Wrangler 4.151.3, Cloudflare Pages, Pages Functions in advanced mode, and D1. Frameworks and integration were installed from their `latest` tags on October 21, 2026; `package-lock.json` locks the tested versions. TypeScript 6.0.3 is the latest major supported by the current Astro checker peer dependency.

Astro builds the static shell and Svelte dashboard. `scripts/build-worker.mjs` bundles the Pages advanced-mode `_worker.js`, including the API and origin authentication. It calculates CSP hashes from Astro's generated inline bootstrap scripts; always use `npm run build` to build both pieces together. No Astro Cloudflare adapter is needed for this static-shell architecture.

## Local development

Requires Node.js 24 or later.

```sh
npm ci
npm run db:local
npm run dev
```

The server prints its loopback URL (normally http://127.0.0.1:8788 or :8787). Local authentication bypass requires both `LOCAL_DEV=true` and a loopback hostname. Remote requests always require a valid Access token. The local D1 database is separate from production and begins empty. Choose the starter countdowns or create your first event. Rebuild and restart after source edits.

## Validation

```sh
npm run check
npm run typecheck
npm test
npm run build
```

Tests cover repeat boundaries, old minutely schedules, month-end dates, leap years, daylight saving, input validation, and signed Access tokens, including unauthorized email, expiration, wrong issuer, wrong audience, and missing/forged tokens.

## Cloudflare deployment

`wrangler.jsonc` contains the actual Pages project, D1 binding, and non-secret Access settings. There are no API credentials in this repository. Authenticate Wrangler with your own Cloudflare account before using the following commands:

```sh
npx wrangler login
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

The project is a direct-upload Pages project; no Git repository integration is required. Preview deployments intentionally have no production DB binding. Add a separate preview D1 database if preview persistence is needed. Never bind previews to production data just to make them pass a check.

## Access configuration

- Zero Trust organization: `morning-wildflower-98d1.cloudflareaccess.com`
- Access application: `Little by little` (`b5349215-13c3-4fc9-b92b-8e49266216d4`)
- Domains: `little-by-little-aggre.pages.dev` and `*.little-by-little-aggre.pages.dev`
- Identity provider: Email code (one-time PIN)
- Allow policy: exact email `hiroyuki.aggre@gmail.com`; no bypass policy
- Session duration: 24 hours

The Pages worker verifies the Access JWT's RS256 signature, issuer, audience, expiry, and email before serving any page, static asset, or API. It uses the verified email for D1 ownership. Mutations require a same-origin request and are parameterized. Inputs are bounded and validated server-side. The event cap is 500 per owner. The application fails closed when Access is missing or misconfigured. To add a custom domain, first protect it in the same Access application; otherwise the application may be unreachable or use the wrong audience.

To change allowed email, update both the Access policy and `ALLOWED_EMAIL` in the Pages production environment and Wrangler configuration. Generate types again with `npx wrangler types worker-configuration.d.ts`.

## Free-tier behavior

No paid subscription or upgrade was created. D1 is used through a native binding. Timers update entirely in the browser, with no polling or per-second database reads. Events are read on load and window focus and written only for user changes. D1's published Free allocation at implementation time is 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage. Pages Functions share the Workers Free request allowance; Access also has its own free-plan user allowance. Cloudflare dashboard usage and account plan remain the authority. Limits can change; see https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/workers/platform/pricing/.

The OAuth connection used to provision this application could not read billing subscriptions, so no claim is made about any unrelated paid products on the account. The application does not purchase or automatically upgrade services.

## Operational notes

- Export events from the footer to download a JSON backup. The app does not include JSON import.
- Open tabs refresh records when the window regains focus. Simultaneous edits from two tabs use the last successful write.
- The dashboard clock defaults to Japan Standard Time; individual event zones are independently configurable.
- Repeated times during a daylight-saving fall-back use the earlier occurrence; nonexistent spring-forward times move forward, following Temporal's compatible disambiguation.
- Authentication email delivery and a real authorized browser session require the owner to complete the emailed one-time PIN. Automated validation does not bypass that login.
- Roll back using Cloudflare Pages deployment history. Export D1 data before making destructive schema changes; application deletion and database deletion are separate operations.
