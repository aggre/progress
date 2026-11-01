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

## Add to Home Screen

**Add to Home Screen** is available before sign-in and under **Settings** after sign-in in supported browsers. It opens the browser's installation prompt when available, or shows the appropriate browser-menu instructions. On iPhone and iPad, use Safari's **Share → Add to Home Screen**, then open the new icon to sign in and enable notifications.

The control hides when running as an installed app and after the browser reports a completed installation. Ordinary browser tabs cannot reliably detect all existing installations, so they may still show installation guidance. No permanent local installation flag is stored, allowing the control to return after uninstalling.

The signed-in dashboard opens directly on **Your time, in progress.** Use **Settings** in the header for push notifications, installation, event export, and sign-out. **Family** and **Add event** remain directly accessible. Closing Settings preserves the event search, filter, and sort order.

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

Run `npm run lint` separately for the strict functional programming rules. Lint
is not part of CI or the commands above. `npm run lint:report` writes a JSON
report to `work/eslint-report.json`.
See [functional programming and linting](docs/linting.md) for the shared root
configuration, Web overrides, and Ramda usage.

## Deployment

- Frontend: GitHub Actions builds the web workspace on changes to `main`, then deploys to GitHub Pages. The committed API origin is `https://little-by-little-api.aggre-progress.workers.dev`; the optional `PUBLIC_API_BASE_URL` repository variable overrides it. Invalid production configuration fails the workflow.
- API: apply the D1 migrations, then run `npm run deploy:api` with an authenticated Cloudflare CLI. The Pages workflow does not hold a Cloudflare credential or deploy the API.
- Web Push: configure the VAPID keys and deploy the API, migration, and frontend as described in [Web Push setup](docs/operations.md#web-push-setup). Adding the code alone does not enable production delivery.
- Accounts: leave the production user database empty until the owner starts a login attempt and an operator approves that specific request.

The intended project URL is `https://aggre.github.io/progress/`. GitHub Pages serves public HTML and JavaScript; schedule data and family operations are protected by the API and are never embedded in the static build. No private source ZIP is included in the public Pages artifact.

## Schedule behavior

- Event name, emoji, target date, and per-event color; create, edit, delete, search, filters, and sorting.
- One-time countdowns start automatically when created and keep their start time when edited. Recurring events repeat every N minutes, hours, days, weeks, months, or years.
- Event-specific IANA time zones. Calendar repeats follow local daylight-saving changes.
- Month-end and leap-day dates remain anchored: January 31 becomes February 28, then March 31; February 29 returns in leap years.
- Events are shared with everyone in the creator's family. Only the creator can edit or delete an event. Family membership also authorizes login approval and member management.
- Progress updates run in the browser. Only login approval polls the API; countdown ticks do not read D1.
- Web Push reminders are opt-in from the dashboard, with a default reminder 10 minutes before each family event (choose 1, 5, 10, 15, 30, or 60 minutes). **Enable notifications** registers this browser with the API; **Test notification** sends a push from the server to check the delivery path.
- A Worker checks upcoming events every minute using each event's time zone and recurrence. Delivery receipts and notification tags suppress repeated reminders across reloads and open tabs. Search and filters do not affect reminders; no open-tab notification timer is needed.
- Notifications can arrive after the app tab closes. HTTPS (or localhost), a browser with Push API support, browser permission, and device notification settings are required. Device sleep, offline operation, browser shutdown, or force-stop can delay or prevent delivery; Web Push is not an exact alarm. On iPhone and iPad, use a supported version of iOS/iPadOS and add the app to the Home Screen before enabling notifications.
- Subscriptions belong to the current signed-in browser session. Turning notifications off or signing out stops future sends; session expiry also stops sends. Sign in again and enable notifications to resume. A push already accepted by the browser's push service may still be delivered.

## Family roulettes

Open **Add event → Roulette**, or **Family roulettes**, to save a wheel of fun
activities for everyone in your family. Give it a name, 2–20 choices, and a play
time of 1–240 minutes. Optionally add one task to do afterward, such as **Clean up**
for 5 minutes (1–60 minutes). Only the wheel's creator can change its settings.
Existing wheels default to 30 minutes with no follow-up task.

Flick with a finger or mouse to set the speed and direction. Grab the wheel again
to slow down, speed up, reverse, or hold it still. The **Spin the wheel** button
also supports keyboard input and reduced-motion preferences.

After a spin, review the play time and optional task, then press **Start this
plan**. Spinning or rerolling alone does not create a schedule. Starting saves one
family-shared activity card, owned by the person who started it. The card switches
from play to the follow-up task automatically, and completes after both steps.
Use **Show completed** to see finished activities. The starter can delete the
whole activity using its × button; started plans keep their saved settings.

Times are stored as absolute instants, so reloading or returning from a sleeping
tab shows the correct step. A start request has a stable ID to avoid duplicates
when a save is retried. Later changes to or deletion of a wheel do not alter
activities that have already started. Spins themselves stay on the current device;
saved wheels and activities are shared. Refresh the wheel list to see family edits.

Apply migrations `0004_roulettes.sql` and `0005_activity_plans.sql` before deploying
the API and frontend updates (`npm run db:local` for development;
`npm run db:remote` for production).
