# Operations

These instructions describe the deployment and operator workflow. Actual deployment status is determined by the GitHub Actions run and Cloudflare deployment results, not by this document.

## Configure the services

The repository is `aggre/progress`. The web workspace builds for `https://aggre.github.io/progress/`; its assets, home link, and QR approval links must all preserve the `/progress/` base path.

1. Deploy the Hono API to Cloudflare Workers with the existing D1 binding.
2. In `apps/api/wrangler.jsonc`, set `FRONTEND_ORIGIN` to `https://aggre.github.io` and `APP_BASE_URL` to `https://aggre.github.io/progress/`. An origin has no `/progress/` path. The `development` environment uses `http://127.0.0.1:4321` and its root base URL instead.
3. The workflow defaults to the committed API origin `https://little-by-little-api.aggre-progress.workers.dev`. Set the optional `PUBLIC_API_BASE_URL` Actions variable only when overriding that origin.
4. In the repository's Pages settings, choose **GitHub Actions** as the build and deployment source.
5. Push the frontend/workflow changes to `main`, or run the Pages workflow manually. Confirm that the `github-pages` environment deployment succeeds.

No repository variable is required for the current deployment. To point a future deployment at a different API, an authorized owner can set an override:

```sh
gh variable set PUBLIC_API_BASE_URL \
  --repo aggre/progress \
  --body 'https://YOUR-API.YOUR-SUBDOMAIN.workers.dev'
```

The Pages workflow uses Node.js 24, `npm ci`, and `npm run build:web`, then uploads only `apps/web/dist`. It validates the selected origin and fails if it is invalid or local. It also rejects a generated Worker bundle or ZIP archive in the Pages artifact. It neither deploys the API nor stores Cloudflare credentials.

## Apply migrations and deploy the API

With Cloudflare CLI access configured for the intended account:

```sh
npm ci
npm run db:remote
npm run deploy:api
```

Use `npm run db:local` for local D1. Direct local Wrangler commands must select `--env development`; the production configuration allows only the GitHub Pages origin. Local and production databases are separate. There is no local authentication bypass: use the same first-user bootstrap flow against the local database when testing.

Before a migration that changes ownership or removes data, export the database through Cloudflare's supported D1 export tooling. Preserve the old Cloudflare Pages deployment until the new API and GitHub Pages frontend pass verification. Retire its traffic and remove the app-specific Access application only after the replacement works; do not delete unrelated Zero Trust settings or the D1 database.

## Web Push setup

Web Push needs both API and frontend deployment. The static frontend's service worker receives encrypted pushes; the API's every-minute Cron Trigger finds upcoming family events and sends them through each browser's push service. The existing daily authentication cleanup remains separate. Deploying the frontend by itself does not configure the sender or apply the subscription tables.

### Production

1. Generate a VAPID key pair once, into the ignored `work/` directory:

   ```sh
   npm run push:keys -- --output work/vapid-secrets.json
   ```

   The generator creates a new file with owner-only permissions, refuses to overwrite existing files, and prints only the destination path. Keep the file private and retain the same key pair for future deployments. Never put the private key in the web workspace, a GitHub Pages variable, source control, terminal output, or a command argument.

2. Set `VAPID_SUBJECT` in `apps/api/wrangler.jsonc` to a stable operator contact URI (`mailto:` or HTTPS). The committed HTTPS app URL is the default. This value is public; the VAPID private key belongs in Worker secrets.

3. Apply D1 migrations, including `0003_web_push.sql`, to the intended production database:

   ```sh
   npm run db:remote
   ```

4. With Cloudflare CLI access for the intended account and the existing Worker, load both keys from the private JSON file, then deploy the API:

   ```sh
   npx wrangler secret bulk work/vapid-secrets.json --config apps/api/wrangler.jsonc --env=""
   npm run deploy:api
   ```

   The Worker requires `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`; only the public key is returned by the authenticated configuration endpoint. `secret bulk` updates the deployed Worker's secrets, so run it as part of the intended rollout, not as a read-only check. Do not regenerate keys for routine deployments.

5. Deploy the matching frontend through the Pages workflow. Sign in, choose **Enable notifications**, grant permission, then use **Test notification**. Verify that the test arrives from the API before checking an event reminder with the app tab closed. Allow at least one scheduler interval; scheduling is checked every minute and delivery timing also depends on the browser and network.

Cloudflare Cron Trigger changes can take time to propagate. Confirm that the deployed Worker has the minute trigger as well as the daily cleanup trigger. Monitor scheduled invocations, delivery failures, and D1 usage. The repository does not automatically upgrade a Cloudflare plan.

### Local development

Create a separate local key pair and apply local migrations:

```sh
npm run push:keys -- --local
npm run db:local
```

`--local` writes the ignored `apps/api/.dev.vars` with owner-only permissions and refuses to replace an existing file. If that file already contains other local secrets, generate a JSON key file under `work/` instead and merge the two VAPID values using a local editor without printing them. Use different keys for local development and production.

Run the frontend normally and start the local API with scheduled-event testing enabled:

```sh
npm run dev:web
```

```sh
npx wrangler dev --config apps/api/wrangler.jsonc --env development --ip 127.0.0.1 --port 8787 --test-scheduled
```

Sign in through the normal approval flow and enable notifications in a browser with Push API support. After creating an event within the selected reminder window, invoke the local minute trigger:

```sh
curl --get --data-urlencode 'cron=* * * * *' http://127.0.0.1:8787/__scheduled
```

The database and scheduler are local, but a real push still needs network access to the browser vendor's push service. **Test notification** also performs a real outbound push; it is not a local notification simulation. Local Cron Triggers are invoked through the testing endpoint rather than running on a production schedule.

### Subscription lifetime and delivery limits

Each subscription is authorized by its current login session. Turning notifications off deletes its server registration, and logout revokes the session and its registrations. The sender excludes expired sessions; the normal login lifetime is 30 days. After signing in again, enable notifications again. Endpoints reported as expired by the push service are removed. Notifications already accepted by a push service can arrive after a later opt-out or logout.

The sender uses the event's current family, time zone, and recurrence. It skips past occurrences and uses delivery receipts to coordinate overlapping scheduler runs. Notification tags identify an occurrence at the browser as well. Web Push does not provide an exactly-once or exact-time delivery guarantee: offline devices, OS notification policy, battery restrictions, full browser shutdown, and force-stop can delay or prevent delivery. iPhone and iPad require a supported iOS/iPadOS version and a Home Screen web app for Web Push.

If a VAPID key is rotated, existing browser subscriptions remain associated with the old application-server key. Coordinate rotation with a frontend refresh and have each browser turn notifications off and enable them again. Keep the previous keys in secure operator storage until the rollout is complete; replacing the private key without the matching public key breaks sending. Never delete other Worker secrets while rotating these two keys.

## Approve the first user

The operator does not register a username in advance. The intended first user must first open the app, enter their desired username, and leave the QR screen open. That screen supplies a request ID and verification code.

Confirm the username and request ID with the person requesting access, then approve that exact pending request through the control-plane CLI:

```sh
npm run bootstrap -- \
  --challenge REQUEST-ID \
  --username EXPECTED-USERNAME \
  --family 'My family' \
  --remote
```

For local development, substitute `--local` for `--remote`.

Bootstrap must reject an expired request, a request for another username, or a database that already contains a user. The operation creates the first family and user and activates only that request's applicant session. The browser then finishes login through its normal polling loop. If the request expires first, start a new browser login and approve its new request ID.

No bootstrap HTTP endpoint, frontend admin secret, email, or OAuth provider is involved. Do not put operator credentials into the web workspace or a repository variable.

### Claim the previous schedule

The migration keeps legacy events inaccessible by default. To assign the previous personal schedule to the first account, explicitly add `--claim-legacy` to the first bootstrap command:

```sh
npm run bootstrap -- \
  --challenge REQUEST-ID \
  --username EXPECTED-USERNAME \
  --family 'My family' \
  --claim-legacy \
  --remote
```

Check the exported backup before doing this. Claiming legacy data is an operator ownership decision; entering a username does not implicitly claim old events.

## Add members and sign in on another device

After the first approval, sign in to an existing device and open the family interface. Add a username there. The server assigns the new account to the current member's family; it cannot be assigned to a different family by supplying an ID.

The new member enters that username on their device. An already signed-in family member scans the QR, compares the displayed username and verification code, and explicitly approves. The requesting browser completes login automatically. An existing session can also approve another device for the same user.

There is no anonymous signup path. Someone without a registered account and an approving family session cannot use schedules, create members, or view family records.

## Verification checklist

- With no account/session, only the login screen is visible; direct protected API requests fail.
- Unknown usernames produce pending challenges without creating users.
- The QR opens under `/progress/`, works in a new browser tab, and exposes no polling or session secret.
- A session from another family cannot inspect or approve the request.
- Approval activates one session; repeat polls and repeat approvals do not create extra sessions.
- Logout revokes the API session, and an old token stops working.
- Members can manage only their own family's membership and view events created by anyone in that family. Only the event creator can edit or delete it. Other families cannot access those events.
- The frontend's network requests target the production Worker, never localhost.
- No login or account is created by deployment itself.
- Web Push **Test notification** reaches a subscribed browser from the API, and an upcoming event can notify after the app tab is closed.
- Turning notifications off and signing out prevent future scheduled sends for that browser session; other signed-in devices keep their own subscriptions.

## Rollback and maintenance

Git history retains the previous implementation at the `baseline-cloudflare-pages` tag. GitHub Actions deployment history can restore an earlier frontend, but its API contract must remain compatible with the deployed Worker. Restore or redeploy a matching API version when rolling back an API-breaking change. Database migration rollback requires a deliberate data plan; rolling back static files does not reverse a D1 migration.

Retain an authenticated device when moving to another device. If every family session expires or is lost, normal QR approval has no authenticated approver; recovery requires a separately reviewed operator procedure. The one-time first-user bootstrap deliberately cannot create or replace another first user after initialization.

Monitor D1 reads/writes and Worker requests in the Cloudflare dashboard. Countdown ticks stay client-side, pending login requests create polling traffic, and Web Push scheduling adds minute-trigger reads and delivery writes. Keep polling intervals, expiry, request-size limits, and cleanup in place. This application does not upgrade a Cloudflare plan automatically.
