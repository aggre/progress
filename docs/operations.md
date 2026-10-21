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
- Members can manage only their own family's membership, and events remain private to their owner.
- The frontend's network requests target the production Worker, never localhost.
- No login or account is created by deployment itself.

## Rollback and maintenance

Git history retains the previous implementation at the `baseline-cloudflare-pages` tag. GitHub Actions deployment history can restore an earlier frontend, but its API contract must remain compatible with the deployed Worker. Restore or redeploy a matching API version when rolling back an API-breaking change. Database migration rollback requires a deliberate data plan; rolling back static files does not reverse a D1 migration.

Retain an authenticated device when moving to another device. If every family session expires or is lost, normal QR approval has no authenticated approver; recovery requires a separately reviewed operator procedure. The one-time first-user bootstrap deliberately cannot create or replace another first user after initialization.

Monitor D1 reads/writes and Worker requests in the Cloudflare dashboard. Countdown ticks stay client-side, while pending login requests create polling traffic. Keep polling intervals, expiry, request-size limits, and cleanup in place. This application does not upgrade a Cloudflare plan automatically.
