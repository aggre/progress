# Little by little

An English-language schedule app with live countdowns, repeating events, and custom progress bars. The frontend runs on GitHub Pages; a separate Hono API on Cloudflare Workers stores accounts, families, sessions, and events in Cloudflare D1.

There is no public account registration. With an empty user database, nobody can sign in or access schedule data. The first account is created only when an operator approves a specific pending login attempt. After that, authenticated family members can add members to their own family and approve their logins.

## Repository

```text
apps/web/          Astro + Svelte static frontend
apps/api/          Hono API, Worker configuration, API tests, D1 migrations
packages/shared/   Event calculations and API types
scripts/           Operator tools
.github/workflows/ GitHub Pages frontend deployment
```

The previous Cloudflare Pages implementation is preserved in Git history at `baseline-cloudflare-pages`. This architecture does not use Cloudflare Access, email codes, passwords, or OAuth for application login.

## Login

1. Enter a username to display a short-lived QR code.
2. An already signed-in family member scans the code on another device.
3. That member reviews the username and verification code and approves the request.
4. The requesting browser polls the API and signs in automatically after approval.

An existing signed-in device can approve another device for the same user. A QR code alone cannot read schedules or grant a login session. Unknown usernames do not create accounts. There is no signup link or public registration API.

See [architecture and authentication](docs/architecture.md) for the protocol and [operations](docs/operations.md) for first-user approval and deployment.

## Local development

Requires Node.js 24 or later.

```sh
npm ci
npm run db:local
```

Start the API and frontend in separate terminals:

```sh
npm run dev:api
```

```sh
npm run dev:web
```

The frontend uses `http://127.0.0.1:8787` for the API in local development. Local development follows the same account and family approval flow as production; there is no authentication bypass. To create the first local account, start a login attempt in the browser and run the operator bootstrap command described in [operations](docs/operations.md#approve-the-first-user).

## Checks and builds

```sh
npm run check
npm test
npm run build
```

`npm run build:web` produces only `apps/web/dist`, the GitHub Pages artifact. `npm run build:api` validates and bundles the separate Worker without deploying it. Neither build deploys resources or upgrades a plan.

Run `npm run lint` separately for the strict functional programming rules. Existing
lint errors are tracked for later cleanup; lint is not part of CI or the commands
above. `npm run lint:report` writes a JSON report to `work/eslint-report.json`.
See [functional programming and linting](docs/linting.md) for the shared root
configuration, Web overrides, and Ramda usage.

## Deployment

- Frontend: GitHub Actions builds the web workspace on changes to `main`, then deploys to GitHub Pages. The committed API origin is `https://little-by-little-api.aggre-progress.workers.dev`; the optional `PUBLIC_API_BASE_URL` repository variable overrides it. Invalid production configuration fails the workflow.
- API: apply the D1 migrations, then run `npm run deploy:api` with an authenticated Cloudflare CLI. The Pages workflow does not hold a Cloudflare credential or deploy the API.
- Accounts: leave the production user database empty until the owner starts a login attempt and an operator approves that specific request.

The intended project URL is `https://aggre.github.io/progress/`. GitHub Pages serves public HTML and JavaScript; schedule data and family operations are protected by the API and are never embedded in the static build. No private source ZIP is included in the public Pages artifact.

## Schedule behavior

- Event name, emoji, target date, and per-event color; create, edit, delete, search, filters, and sorting.
- One-time countdowns start automatically when created and keep their start time when edited. Recurring events repeat every N minutes, hours, days, weeks, months, or years.
- Event-specific IANA time zones. Calendar repeats follow local daylight-saving changes.
- Month-end and leap-day dates remain anchored: January 31 becomes February 28, then March 31; February 29 returns in leap years.
- Events are shared with everyone in the creator's family. Only the creator can edit or delete an event. Family membership also authorizes login approval and member management.
- Progress updates run in the browser. Only login approval polls the API; countdown ticks do not read D1.
