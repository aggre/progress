import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { EventInput } from '@little/shared/events';

const origin = 'http://127.0.0.1:4321';
const testEntry = `
  import api from './apps/api/src/index.ts';
  import { runPushReminders } from './apps/api/src/push-scheduler.ts';
  export default { async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/__test/run-push') {
      await runPushReminders(env, Number(request.headers.get('X-Test-Now')));
      return new Response('ok');
    }
    return api.fetch(request, env, ctx);
  } };
`;
const script = (await build({ stdin: { contents: testEntry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })).outputFiles[0].text;
type MigrationState = Readonly<{ pending: string; statements: Readonly<Record<number, string>>; count: number }>;
interface User { readonly id: string; readonly familyId: string; readonly token: string; readonly sessionHash: string; }
interface Outgoing { readonly endpoint: string; readonly ttl: number; readonly encoding: string | null; readonly vapid: boolean; readonly bytes: number; }
interface Subscription { readonly endpoint: string; readonly keys: Readonly<{ p256dh: string; auth: string }>; }

function migrationLine(state: MigrationState, line: string): MigrationState {
  const pending = state.pending + line + '\n';
  const complete = /^CREATE TRIGGER\b/i.test(pending.trimStart()) ? /^END;\s*$/.test(line) : /;\s*$/.test(line);
  return !line.trim() || line.trimStart().startsWith('--') ? state
    : complete ? { pending: '', statements: { ...state.statements, [state.count]: pending }, count: state.count + 1 }
    : { ...state, pending };
}

function makeKeys(curve: 'prime256v1'): Readonly<{ publicKey: string; privateKey: string }> {
  // eslint-disable-next-line functional/prefer-immutable-types -- The native ECDH handle creates isolated test keys, never production credentials.
  const pair = createECDH(curve);
  // eslint-disable-next-line functional/no-expression-statements -- Generate random test keys through the Node cryptographic boundary.
  pair.generateKeys();
  return { publicKey: pair.getPublicKey().toString('base64url'), privateKey: Buffer.from(pair.getPrivateKey().toString('hex').padStart(64, '0'), 'hex').toString('base64url') };
}
const vapid = makeKeys('prime256v1');
const receiver = makeKeys('prime256v1');
function subscription(name: string): Subscription {
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: receiver.publicKey, auth: randomBytes(16).toString('base64url') } };
}
function event(now: number, minutes = 5, repeatUnit: EventInput['repeatUnit'] = 'none'): EventInput {
  return { title: 'Family moment', emoji: '✨', color: '#7ba989', startAt: new Date(now - 86400_000).toISOString(), targetAt: new Date(now + minutes * 60_000).toISOString(), repeatUnit, repeatEvery: 1, timeZone: 'UTC' };
}

// eslint-disable-next-line functional/prefer-immutable-types -- The test lifecycle owns the native worker/database handles and asynchronous fixture cleanup.
async function fixture(t: TestContext, configured = true) {
  // eslint-disable-next-line functional/prefer-immutable-types -- The outbound mock records mutable network observations for assertions.
  const outgoing: Outgoing[] = [];
  // eslint-disable-next-line functional/prefer-immutable-types -- Tests control the simulated push provider's next HTTP response.
  const provider = { status: 201 };
  // eslint-disable-next-line functional/prefer-immutable-types -- The isolated Miniflare instance owns mutable D1 and worker lifecycle handles.
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'push-api', modules: true, script, compatibilityDate: '2026-10-21', compatibilityFlags: ['nodejs_compat'], bindings: {
    FRONTEND_ORIGIN: origin, APP_BASE_URL: origin + '/progress/',
    ...(configured ? { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'https://example.test/contact' } : {}),
  }, d1Databases: { DB: randomUUID() },
  // eslint-disable-next-line functional/prefer-immutable-types -- Intercept the native outbound request, consuming only this test's encrypted request body.
  outboundService: async request => {
    // eslint-disable-next-line functional/no-expression-statements, functional/immutable-data -- Record the native provider request at the isolated test network boundary.
    outgoing.push({ endpoint: request.url, ttl: Number(request.headers.get('TTL')), encoding: request.headers.get('Content-Encoding'), vapid: request.headers.get('Authorization')?.startsWith('vapid ') === true, bytes: (await request.arrayBuffer()).byteLength });
    return new Response(null, { status: provider.status });
  } }));
  // eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Dispose this isolated runtime at the test runner lifecycle boundary.
  t.after(() => mf.dispose());
  // eslint-disable-next-line functional/prefer-immutable-types -- The native D1 handle applies real migrations and fixture writes.
  const db = await mf.getD1Database('DB');
  // eslint-disable-next-line functional/no-loop-statements -- Migrations must be applied sequentially to the isolated test database.
  for (const file of ['0001_events.sql', '0002_family_auth.sql', '0003_web_push.sql']) {
    const migration = (await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8')).split('\n').reduce(migrationLine, { pending: '', statements: {}, count: 0 });
    // eslint-disable-next-line functional/no-loop-statements -- Each schema statement depends on the previous statement having completed.
    for (const statement of Object.values(migration.statements)) {
      // eslint-disable-next-line functional/no-expression-statements -- Apply an isolated migration at the D1 persistence boundary.
      await db.prepare(statement).run();
    }
    // eslint-disable-next-line functional/no-expression-statements -- Ensure the test has applied every complete migration statement.
    assert.equal(migration.pending.trim(), '');
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Test HTTP requests dispatch through the real worker and Hono authentication middleware.
  const request = (path: string, method = 'GET', body?: unknown, user?: User) => mf.dispatchFetch('https://api.example' + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line functional/prefer-immutable-types -- Seed an isolated authenticated user/session at the D1 fixture boundary.
  async function addUser(name: string, familyId = randomUUID()): Promise<User> {
    const id = randomUUID(), token = randomBytes(32).toString('base64url'), challengeId = randomUUID();
    const sessionHash = createHash('sha256').update(token).digest('hex');
    // eslint-disable-next-line functional/no-expression-statements -- The fixture seeds valid schema relationships without weakening production authentication.
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO families (id,name) VALUES (?,?)').bind(familyId, 'Test family'),
      db.prepare('INSERT INTO users (id,username,family_id) VALUES (?,?,?)').bind(id, name, familyId),
      db.prepare("INSERT INTO login_challenges (id,username,poll_hash,approval_hash,session_hash,verification_code,status,created_at,expires_at) VALUES (?,?,?,?,?,?,'pending',unixepoch(),unixepoch()+300)").bind(challengeId, name, randomUUID(), randomUUID(), sessionHash, '123456'),
      db.prepare('INSERT INTO sessions (token_hash,user_id,challenge_id,created_at,expires_at) VALUES (?,?,?,unixepoch(),unixepoch()+2592000)').bind(sessionHash, id, challengeId),
    ]);
    return { id, token, familyId, sessionHash };
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- The test-only worker route dispatches the real scheduler with a deterministic clock.
  const run = (now: number) => mf.dispatchFetch('https://api.example/__test/run-push', { headers: { 'X-Test-Now': String(now) } });
  // eslint-disable-next-line functional/prefer-immutable-types -- Persist an event through the public authenticated API for scheduler assertions.
  async function addEvent(user: User, input: EventInput): Promise<Readonly<{ id: string }>> {
    // eslint-disable-next-line functional/prefer-immutable-types -- Check and consume the native worker response at the test HTTP boundary.
    const response = await request('/api/schedules', 'POST', input, user);
    // eslint-disable-next-line functional/no-expression-statements -- Verify fixture creation before depending on its event identifier.
    assert.equal(response.status, 201);
    return ((await response.json()) as Readonly<{ event: Readonly<{ id: string }> }>).event;
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Subscribe through the authenticated API rather than bypassing subscription validation.
  async function enable(user: User, value: Subscription, minutes = 10): Promise<void> {
    return assert.equal((await request('/api/push/subscription', 'PUT', { subscription: value, minutes }, user)).status, 200);
  }
  return { mf, db, request, addUser, run, addEvent, enable, outgoing, provider };
}

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('push endpoints require authentication and report missing VAPID configuration safely', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t, false);
  const user = await f.addUser('first-user');
  const sub = subscription('missing-config');
  return assert.deepEqual([
    (await f.request('/api/push/config')).status,
    (await f.request('/api/push/subscription', 'PUT', { subscription: sub, minutes: 10 })).status,
    (await f.request('/api/push/status', 'POST', { endpoint: sub.endpoint })).status,
    (await f.request('/api/push/subscription', 'DELETE', { endpoint: sub.endpoint })).status,
    (await f.request('/api/push/test', 'POST', { endpoint: sub.endpoint })).status,
    await (await f.request('/api/push/config', 'GET', undefined, user)).json(),
    (await f.request('/api/push/subscription', 'PUT', { subscription: sub, minutes: 10 }, user)).status,
    await f.db.prepare('SELECT count(*) AS n FROM push_subscriptions').first('n'),
  ], [401, 401, 401, 401, 401, { configured: false, publicKey: null }, 503, 0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('push subscriptions reject unsafe endpoints, malformed keys, and unsupported reminder intervals', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const user = await f.addUser('first-user'), sub = subscription('validation');
  // eslint-disable-next-line functional/no-loop-statements -- Exercise independent HTTP validation failures sequentially within the API rate limit.
  for (const endpoint of ['http://fcm.googleapis.com/send/test', 'https://127.0.0.1/private', 'https://fcm.googleapis.com.evil.test/send/test', 'https://user:secret@fcm.googleapis.com/send/test', 'https://fcm.googleapis.com:8443/send/test', 'https://fcm.googleapis.com/send/test#fragment']) {
    // eslint-disable-next-line functional/no-expression-statements -- Assert validation at the native HTTP boundary.
    assert.equal((await f.request('/api/push/subscription', 'PUT', { subscription: { ...sub, endpoint }, minutes: 10 }, user)).status, 400);
  }
  return assert.deepEqual([
    (await f.request('/api/push/subscription', 'PUT', { subscription: { ...sub, keys: { ...sub.keys, p256dh: 'bad' } }, minutes: 10 }, user)).status,
    (await f.request('/api/push/subscription', 'PUT', { subscription: { ...sub, keys: { ...sub.keys, auth: 'bad' } }, minutes: 10 }, user)).status,
    (await f.request('/api/push/subscription', 'PUT', { subscription: sub, minutes: 0 }, user)).status,
    (await f.request('/api/push/subscription', 'PUT', { subscription: sub, minutes: 7 }, user)).status,
    (await f.request('/api/push/subscription', 'PUT', { subscription: sub, minutes: '10' }, user)).status,
    await f.db.prepare('SELECT count(*) AS n FROM push_subscriptions').first('n'),
  ], [400, 400, 400, 400, 400, 0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('push subscriptions belong to one session and test sends a real encrypted provider request', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const first = await f.addUser('first-user'), second = await f.addUser('second-user');
  const sub = subscription('ownership');
  // eslint-disable-next-line functional/no-expression-statements -- Establish the authenticated browser subscription before exercising ownership checks.
  await f.enable(first, sub);
  // eslint-disable-next-line functional/no-expression-statements -- Verify that another session cannot observe or replace an active endpoint.
  assert.deepEqual([
    await (await f.request('/api/push/status', 'POST', { endpoint: sub.endpoint }, first)).json(),
    await (await f.request('/api/push/status', 'POST', { endpoint: sub.endpoint }, second)).json(),
    (await f.request('/api/push/subscription', 'PUT', { subscription: sub, minutes: 5 }, second)).status,
    (await f.request('/api/push/test', 'POST', { endpoint: sub.endpoint }, second)).status,
  ], [{ subscribed: true, minutes: 10 }, { subscribed: false, minutes: null }, 409, 404]);
  // eslint-disable-next-line functional/no-expression-statements -- A foreign-session delete must not remove the current browser's subscription.
  await f.request('/api/push/subscription', 'DELETE', { endpoint: sub.endpoint }, second);
  // eslint-disable-next-line functional/no-expression-statements -- Updating preferences must reuse the session subscription rather than duplicating it.
  await f.enable(first, sub, 5);
  return assert.deepEqual([
    await f.db.prepare('SELECT count(*) AS n FROM push_subscriptions').first('n'),
    await (await f.request('/api/push/status', 'POST', { endpoint: sub.endpoint }, first)).json(),
    (await f.request('/api/push/test', 'POST', { endpoint: sub.endpoint }, first)).status,
    f.outgoing.length,
    f.outgoing[0]?.endpoint, f.outgoing[0]?.encoding, f.outgoing[0]?.vapid, (f.outgoing[0]?.bytes || 0) > 100,
  ], [1, { subscribed: true, minutes: 5 }, 200, 1, sub.endpoint, 'aes128gcm', true, true]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('concurrent push scans deduplicate due family events and advance recurring occurrences', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const now = Date.now(), owner = await f.addUser('first-user');
  const family = await f.addUser('family-user', owner.familyId), outsider = await f.addUser('outsider');
  // eslint-disable-next-line functional/no-expression-statements -- Set up one browser and both visible and inaccessible event fixtures.
  await f.enable(owner, subscription('scheduler'));
  const recurring = await f.addEvent(family, event(now, 0.5, 'minute'));
  // eslint-disable-next-line functional/no-expression-statements -- Seed boundary events through authenticated requests.
  await f.addEvent(owner, event(now, 20));
  // eslint-disable-next-line functional/no-expression-statements -- Completed events must not replay when a browser has a push subscription.
  await f.addEvent(owner, event(now, -1));
  // eslint-disable-next-line functional/no-expression-statements -- Other families' due events must never be sent to this endpoint.
  await f.addEvent(outsider, event(now, 1));
  // eslint-disable-next-line functional/no-expression-statements -- Dispatch overlapping cron scans to exercise the database delivery claim.
  await Promise.all([f.run(now), f.run(now)]);
  // eslint-disable-next-line functional/no-expression-statements -- The same occurrence must produce exactly one provider request and receipt.
  assert.deepEqual([f.outgoing.length, await f.db.prepare('SELECT count(*) AS n FROM push_deliveries WHERE event_id=? AND sent_at IS NOT NULL').bind(recurring.id).first('n')], [1, 1]);
  // eslint-disable-next-line functional/no-expression-statements -- A repeat scan of the same occurrence must leave the existing receipt untouched.
  await f.run(now + 1000);
  // eslint-disable-next-line functional/no-expression-statements -- The next recurrence has a distinct occurrence identity and is eligible again.
  await f.run(now + 60_000);
  return assert.deepEqual([f.outgoing.length, await f.db.prepare('SELECT count(*) AS n FROM push_deliveries WHERE event_id=? AND sent_at IS NOT NULL').bind(recurring.id).first('n'), f.outgoing.every(item => item.ttl > 0 && item.ttl <= 30)], [2, 1, true]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('push scans honor edited/deleted events, disabled subscriptions, and logout', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const now = Date.now(), user = await f.addUser('first-user'), sub = subscription('cancellation');
  // eslint-disable-next-line functional/no-expression-statements -- Enable the current authenticated browser before mutating its schedules.
  await f.enable(user, sub);
  const edited = await f.addEvent(user, event(now)), deleted = await f.addEvent(user, event(now));
  // eslint-disable-next-line functional/no-expression-statements -- Rescheduling a target outside the reminder window must cancel its prior eligibility.
  await f.request('/api/schedules/' + edited.id, 'PUT', event(now, 60), user);
  // eslint-disable-next-line functional/no-expression-statements -- Remove the second event before the scheduler reads it.
  await f.request('/api/schedules/' + deleted.id, 'DELETE', undefined, user);
  // eslint-disable-next-line functional/no-expression-statements -- Scan against the current database state.
  await f.run(now);
  // eslint-disable-next-line functional/no-expression-statements -- There is no due event after both changes.
  assert.equal(f.outgoing.length, 0);
  // eslint-disable-next-line functional/no-expression-statements -- Seed a due event after explicitly disabling the subscription.
  await f.request('/api/push/subscription', 'DELETE', { endpoint: sub.endpoint }, user);
  // eslint-disable-next-line functional/no-expression-statements -- Persist a new due event through the authenticated API.
  await f.addEvent(user, event(now));
  // eslint-disable-next-line functional/no-expression-statements -- Disabled browsers must remain silent even when a new event is due.
  await f.run(now);
  // eslint-disable-next-line functional/no-expression-statements -- Re-enable and deliver once so logout can also exercise delivery-receipt cleanup.
  await f.enable(user, sub);
  // eslint-disable-next-line functional/no-expression-statements -- Send the current due event and persist a receipt.
  await f.run(now);
  // eslint-disable-next-line functional/no-expression-statements -- Sign out through the production authentication endpoint.
  await f.request('/api/auth/logout', 'POST', {}, user);
  // eslint-disable-next-line functional/no-expression-statements -- A revoked session may not receive later notifications.
  await f.run(now + 60_000);
  return assert.deepEqual([f.outgoing.length, await f.db.prepare('SELECT count(*) AS n FROM push_subscriptions').first('n'), await f.db.prepare('SELECT count(*) AS n FROM push_deliveries').first('n')], [1, 0, 0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('push provider 410 removes subscriptions and 503 retries without duplicating successful deliveries', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const now = Date.now(), user = await f.addUser('first-user'), sub = subscription('provider-errors');
  // eslint-disable-next-line functional/no-expression-statements -- Establish a long enough reminder window to exercise backoff and retry.
  await f.enable(user, sub);
  // eslint-disable-next-line functional/no-expression-statements -- Create the due event for provider failure handling.
  await f.addEvent(user, event(now, 9));
  // eslint-disable-next-line functional/no-expression-statements, functional/immutable-data -- Configure the isolated network mock's transient response.
  f.provider.status = 503;
  // eslint-disable-next-line functional/no-expression-statements -- The first cron scan must record a retryable failure, not a successful delivery.
  await f.run(now);
  const retry = await f.db.prepare('SELECT attempts,next_attempt_at,sent_at FROM push_deliveries').first<Readonly<{ attempts: number; next_attempt_at: number; sent_at: number | null }>>();
  // eslint-disable-next-line functional/no-expression-statements -- A scan before the retry delay must not contact the provider again.
  await f.run(now + 1);
  // eslint-disable-next-line functional/no-expression-statements -- Assert that a failure was not recorded as a successful notification.
  assert.deepEqual([f.outgoing.length, retry?.attempts, retry?.sent_at], [1, 1, null]);
  // eslint-disable-next-line functional/no-expression-statements, functional/immutable-data -- Recover the isolated push provider for the scheduled retry.
  f.provider.status = 201;
  // eslint-disable-next-line functional/no-expression-statements -- Retry only once the recorded backoff has elapsed.
  await f.run((retry?.next_attempt_at || now + 120_000) + 1);
  // eslint-disable-next-line functional/no-expression-statements -- A successful retry must suppress subsequent scans of that occurrence.
  await f.run((retry?.next_attempt_at || now + 120_000) + 2);
  // eslint-disable-next-line functional/no-expression-statements -- Verify one failed attempt followed by one successful provider request.
  assert.equal(f.outgoing.length, 2);
  // eslint-disable-next-line functional/no-expression-statements -- Create a new occurrence so the gone-endpoint response is actually attempted.
  await f.addEvent(user, { ...event(now, 8), title: 'Second event' });
  // eslint-disable-next-line functional/no-expression-statements, functional/immutable-data -- Configure permanent subscription expiration at the provider boundary.
  f.provider.status = 410;
  // eslint-disable-next-line functional/no-expression-statements -- Permanent provider expiration must remove the endpoint and its receipts.
  await f.run(now + 180_000);
  return assert.deepEqual([f.outgoing.length, await f.db.prepare('SELECT count(*) AS n FROM push_subscriptions').first('n'), await f.db.prepare('SELECT count(*) AS n FROM push_deliveries').first('n')], [3, 0, 0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('expired sign-ins revoke push subscriptions immediately and expired events are not replayed', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const now = Date.now(), user = await f.addUser('first-user');
  // eslint-disable-next-line functional/no-expression-statements -- Register a browser subscription tied to the test's authenticated session.
  await f.enable(user, subscription('session-expiry'));
  // eslint-disable-next-line functional/no-expression-statements -- Add an event whose reminder would normally be eligible.
  await f.addEvent(user, event(now));
  // eslint-disable-next-line functional/no-expression-statements -- Simulate session expiration through the same D1 field used by logout and normal session checks.
  await f.db.prepare('UPDATE sessions SET expires_at=unixepoch()-1 WHERE token_hash=?').bind(user.sessionHash).run();
  // eslint-disable-next-line functional/no-expression-statements -- Expired sessions cannot receive the still-upcoming event.
  await f.run(now);
  return assert.deepEqual([f.outgoing.length, await f.db.prepare('SELECT count(*) AS n FROM push_subscriptions').first('n')], [0, 0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('VAPID key rotation requires browser resubscription before further delivery', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const now = Date.now(), user = await f.addUser('first-user'), sub = subscription('key-rotation');
  // eslint-disable-next-line functional/no-expression-statements -- Establish a browser registration associated with the fixture's VAPID key.
  await f.enable(user, sub);
  // eslint-disable-next-line functional/no-expression-statements -- Seed an eligible event before simulating a changed server VAPID identity.
  await f.addEvent(user, event(now));
  // eslint-disable-next-line functional/no-expression-statements -- Mark the existing subscription as belonging to an older, incompatible VAPID public key.
  await f.db.prepare('UPDATE push_subscriptions SET vapid_public_key=?').bind(makeKeys('prime256v1').publicKey).run();
  // eslint-disable-next-line functional/no-expression-statements -- The scheduler must not send with a VAPID identity different from the browser subscription.
  await f.run(now);
  return assert.deepEqual([
    await (await f.request('/api/push/status', 'POST', { endpoint: sub.endpoint }, user)).json(),
    f.outgoing.length,
  ], [{ subscribed: false, minutes: null }, 0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('late concurrent cron scans use current time and never replay already-past events', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const now = Date.now(), user = await f.addUser('first-user');
  // eslint-disable-next-line functional/no-expression-statements -- Subscribe a browser before exercising a delayed scheduled invocation.
  await f.enable(user, subscription('late-cron'));
  const upcoming = await f.addEvent(user, event(now, 8));
  // eslint-disable-next-line functional/no-expression-statements -- This event was within the stale clock's reminder window but has already ended in real time.
  await f.addEvent(user, event(now, -1));
  // eslint-disable-next-line functional/no-expression-statements -- Concurrent delayed invocations must agree on the actual upcoming occurrence and share its delivery claim.
  await Promise.all([f.run(now - 600_000), f.run(now - 600_000)]);
  return assert.deepEqual([
    f.outgoing.length,
    await f.db.prepare('SELECT event_id FROM push_deliveries WHERE sent_at IS NOT NULL').first('event_id'),
    f.outgoing.every(item => item.ttl > 0 && item.ttl <= 480),
    await f.db.prepare('SELECT count(*) AS n FROM push_deliveries').first('n'),
  ], [1, upcoming.id, true, 1]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the integration test and receive its native runtime lifecycle context.
await test('endpoint-less revocation affects only the current session and invalid endpoints remain rejected', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the isolated API/D1 test fixture handles.
  const f = await fixture(t);
  const first = await f.addUser('first-user'), otherLogin = await f.addUser('other-login');
  const second: User = { ...first, token: otherLogin.token, sessionHash: otherLogin.sessionHash };
  const firstSubscription = subscription('lost-local-endpoint'), secondSubscription = subscription('other-device');
  // eslint-disable-next-line functional/no-expression-statements -- Model a second authenticated device for the same account, with its own independent login session.
  await f.db.prepare('UPDATE sessions SET user_id=? WHERE token_hash=?').bind(first.id, second.sessionHash).run();
  // eslint-disable-next-line functional/no-expression-statements -- Register the first device before its local endpoint data is lost.
  await f.enable(first, firstSubscription);
  // eslint-disable-next-line functional/no-expression-statements -- Keep another signed-in device active to verify session-scoped revocation.
  await f.enable(second, secondSubscription);
  // eslint-disable-next-line functional/no-expression-statements -- An explicitly invalid endpoint must not be treated as a request to revoke the whole session.
  assert.deepEqual([
    (await f.request('/api/push/subscription', 'DELETE', { endpoint: 'https://127.0.0.1/private' }, first)).status,
    (await f.request('/api/push/subscription', 'DELETE', { endpoint: '' }, first)).status,
    await f.db.prepare('SELECT count(*) AS n FROM push_subscriptions').first('n'),
  ], [400, 400, 2]);
  // eslint-disable-next-line functional/no-expression-statements -- A browser that lost its endpoint can still revoke its current session's server subscription.
  assert.equal((await f.request('/api/push/subscription', 'DELETE', {}, first)).status, 200);
  return assert.deepEqual([
    await (await f.request('/api/push/status', 'POST', { endpoint: firstSubscription.endpoint }, first)).json(),
    await (await f.request('/api/push/status', 'POST', { endpoint: secondSubscription.endpoint }, second)).json(),
    await f.db.prepare('SELECT count(*) AS n FROM push_subscriptions').first('n'),
    (await f.request('/api/push/test', 'POST', { endpoint: secondSubscription.endpoint }, second)).status,
    f.outgoing[0]?.endpoint,
  ], [{ subscribed: false, minutes: null }, { subscribed: true, minutes: 10 }, 1, 200, secondSubscription.endpoint]);
});
