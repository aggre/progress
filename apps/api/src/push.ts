import { Hono } from 'hono';
import { always, tryCatch } from 'ramda';
import { reminderTimes, type ReminderMinutes } from '@little/shared/reminders';
import { jsonObject, requireAuth, throttle } from './security';
import { isSafePushEndpoint, sendWebPush, type WebPushConfig, type WebPushSubscription } from './web-push';
import type { ApiBindings, AppEnv } from './types';

type ConfigBindings = Readonly<Pick<ApiBindings, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>>;
export interface PushRow {
  readonly id: string;
  readonly session_hash: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly minutes: ReminderMinutes;
  readonly vapid_public_key: string;
  readonly revision: number;
}

const validSubject = tryCatch((value: string): boolean => {
  const protocol = new URL(value).protocol;
  return protocol === 'https:' || (protocol === 'mailto:' && value.includes('@'));
}, always(false));
const decodedKey = tryCatch((value: string): string => atob(value.replaceAll('-', '+').replaceAll('_', '/')), always(''));
function validKey(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && value.length === Math.ceil(bytes * 4 / 3)
    && decodedKey(value).length === bytes && (bytes !== 65 || decodedKey(value).charCodeAt(0) === 4);
}

export function pushConfig(env: ConfigBindings): WebPushConfig | null {
  return validKey(env.VAPID_PUBLIC_KEY, 65) && validKey(env.VAPID_PRIVATE_KEY, 32)
    && typeof env.VAPID_SUBJECT === 'string' && validSubject(env.VAPID_SUBJECT)
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT } : null;
}

// eslint-disable-next-line functional/prefer-immutable-types -- Import the browser ECDH key through Web Crypto to reject malformed curve points at the API boundary.
async function subscriptionInput(value: unknown): Promise<WebPushSubscription | null> {
  const data = value && typeof value === 'object' ? value as Readonly<Record<string, unknown>> : {};
  const keys = data.keys && typeof data.keys === 'object' ? data.keys as Readonly<Record<string, unknown>> : {};
  // eslint-disable-next-line functional/no-conditional-statements -- Reject malformed HTTP subscription fields before a cryptographic import.
  if (typeof data.endpoint !== 'string' || !isSafePushEndpoint(data.endpoint) || !validKey(keys.p256dh, 65) || !validKey(keys.auth, 16)) return null;
  // eslint-disable-next-line functional/no-try-statements -- A malformed public curve point rejects at the native Web Crypto boundary.
  try {
    // eslint-disable-next-line functional/no-expression-statements -- Validate the supplied public key without retaining a native CryptoKey.
    await crypto.subtle.importKey('raw', Uint8Array.from(decodedKey(keys.p256dh), character => character.charCodeAt(0)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return { endpoint: data.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
  } catch { return null; }
}

function endpointInput(data: Readonly<Record<string, unknown>>): string | null {
  return typeof data.endpoint === 'string' && isSafePushEndpoint(data.endpoint) ? data.endpoint : null;
}
export function pushRecipient(row: PushRow): WebPushSubscription { return { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }; }

// eslint-disable-next-line functional/prefer-immutable-types -- Retain the native Hono router to register authenticated subscription endpoints.
export const push = new Hono<AppEnv>();
// eslint-disable-next-line functional/no-expression-statements -- Every push configuration, subscription, and test request requires a current login.
push.use('*', requireAuth);
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Return only the public VAPID key through the authenticated HTTP response.
push.get('/config', c => { const config = pushConfig(c.env); return c.json({ configured: !!config, publicKey: config?.publicKey ?? null }); });

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Read this login's subscription through the native HTTP and D1 boundaries.
push.post('/status', async c => {
  const endpoint = await jsonObject(c).then(endpointInput).catch(always(null));
  const config = pushConfig(c.env);
  const row = endpoint ? await c.env.DB.prepare('SELECT minutes FROM push_subscriptions WHERE session_hash=? AND endpoint=? AND vapid_public_key=?')
    .bind(c.get('sessionHash'), endpoint, config?.publicKey ?? '').first<Readonly<{ minutes: ReminderMinutes }>>() : null;
  return !endpoint ? c.json({ error: 'Invalid push subscription.' }, 400)
    : c.json({ subscribed: !!row, minutes: row?.minutes ?? null });
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register or update a subscription at the authenticated HTTP, crypto, and D1 boundaries.
push.put('/subscription', async c => {
  const config = pushConfig(c.env);
  // eslint-disable-next-line functional/no-conditional-statements -- Do not accept subscriptions until the operator has configured VAPID secrets.
  if (!config) return c.json({ error: 'Web Push is not configured on the server yet.' }, 503);
  const allowed = await throttle(c, 'push-write', 30, 60, c.get('identity').user.id);
  const input = allowed ? await jsonObject(c).catch(always(null)) : null;
  const subscription = input ? await subscriptionInput(input.subscription) : null;
  // eslint-disable-next-line functional/no-conditional-statements -- Stop invalid or rate-limited requests before storing their endpoint.
  if (!allowed || !input || !subscription || typeof input.minutes !== 'number' || !Object.hasOwn(reminderTimes, input.minutes)) {
    return c.json({ error: allowed ? 'Choose a valid subscription and reminder time.' : 'Please slow down.' }, allowed ? 400 : 429);
  }
  // eslint-disable-next-line functional/no-try-statements -- Endpoint uniqueness protects another login from being silently replaced.
  try {
    const result: Readonly<{ meta: Readonly<{ changes: number }> }> = await c.env.DB.prepare(`
      INSERT INTO push_subscriptions (id,session_hash,endpoint,p256dh,auth,minutes,vapid_public_key)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>unixepoch())
      ON CONFLICT(session_hash) DO UPDATE SET endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,
        minutes=excluded.minutes,vapid_public_key=excluded.vapid_public_key,revision=push_subscriptions.revision+1,updated_at=unixepoch()
    `).bind(crypto.randomUUID(), c.get('sessionHash'), subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, input.minutes, config.publicKey, c.get('sessionHash')).run();
    return result.meta.changes ? c.json({ ok: true }) : c.json({ error: 'Your session has expired. Please log in again.' }, 401);
  } catch (error) {
    // eslint-disable-next-line functional/no-conditional-statements -- Convert a database uniqueness conflict to an actionable browser registration response.
    if (error instanceof Error && error.message.includes('UNIQUE')) return c.json({ error: 'This browser subscription belongs to another sign-in. Turn notifications off and enable them again.' }, 409);
    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject -- Unexpected D1 errors use the existing sanitized Hono error handler.
    throw error;
  }
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Delete only the requesting session's endpoint, even when VAPID is unavailable.
push.delete('/subscription', async c => {
  const input = await jsonObject(c).catch(always(null));
  const endpoint = input && Object.hasOwn(input, 'endpoint') ? endpointInput(input) : undefined;
  // eslint-disable-next-line functional/no-conditional-statements -- Validate the deletion body before the D1 write.
  if (!input || endpoint === null) return c.json({ error: 'Invalid push subscription.' }, 400);
  // eslint-disable-next-line functional/no-expression-statements -- Revoking a subscription also cascades its pending delivery receipts.
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE session_hash=? AND (? IS NULL OR endpoint=?)').bind(c.get('sessionHash'), endpoint ?? null, endpoint ?? null).run();
  return c.json({ ok: true });
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- An explicit user test sends an encrypted push through the same transport as scheduled reminders.
push.post('/test', async c => {
  const config = pushConfig(c.env);
  // eslint-disable-next-line functional/no-conditional-statements -- No transport is available until VAPID keys are configured.
  if (!config) return c.json({ error: 'Web Push is not configured on the server yet.' }, 503);
  const allowed = await throttle(c, 'push-test', 5, 60, c.get('identity').user.id);
  const endpoint = allowed ? await jsonObject(c).then(endpointInput).catch(always(null)) : null;
  const row = endpoint ? await c.env.DB.prepare(`SELECT p.* FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash
    WHERE p.session_hash=? AND p.endpoint=? AND p.vapid_public_key=? AND s.expires_at>unixepoch()`)
    .bind(c.get('sessionHash'), endpoint, config.publicKey).first<PushRow>() : null;
  // eslint-disable-next-line functional/no-conditional-statements -- Never send to an unregistered endpoint or another session's subscription.
  if (!allowed || !endpoint || !row) return c.json({ error: !allowed ? 'Please slow down.' : !endpoint ? 'Invalid push subscription.' : 'Enable notifications before sending a test.' }, !allowed ? 429 : !endpoint ? 400 : 404);
  // eslint-disable-next-line functional/no-try-statements -- Report provider failures without logging private endpoint URLs or credentials.
  try {
    const result = await sendWebPush(pushRecipient(row), JSON.stringify({ title: 'A little reminder ✨', body: 'Web Push is ready, even when this app is closed.', tag: `little-test:${row.id}`, url: c.env.APP_BASE_URL }), config, 60);
    // eslint-disable-next-line functional/no-conditional-statements -- Expired push endpoints must be removed so the user can subscribe again.
    if (result.status === 404 || result.status === 410) {
      // eslint-disable-next-line functional/no-expression-statements -- Delete only the endpoint revision that the push service rejected.
      await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND revision=?').bind(row.id, row.revision).run();
      return c.json({ error: 'This subscription has expired. Enable notifications again.' }, 410);
    }
    return result.status >= 200 && result.status < 300 ? c.json({ ok: true }) : c.json({ error: 'The push service could not accept the notification. Please try again.' }, 502);
  } catch { return c.json({ error: 'The push service is unavailable. Please try again.' }, 502); }
});
