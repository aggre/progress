import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../apps/web/public/notifications-sw.js', import.meta.url), 'utf8');
const base = 'https://example.test/progress/';
const now = Date.parse('2026-10-29T12:00:00Z');
interface DisplayedNotification {
  readonly title: string;
  readonly body: unknown;
  readonly tag: unknown;
  readonly icon: unknown;
  readonly url: unknown;
}

/* eslint-disable functional/prefer-immutable-types, functional/no-expression-statements, functional/immutable-data, functional/functional-parameters, functional/no-return-void -- This isolated VM adapter captures native worker callbacks, lifetime promises, notifications, and window-client effects for assertions. */
function fixture(existingUrl?: string) {
  const listeners = new Map<string, (event: unknown) => void>();
  const pending = new Map<number, Promise<unknown>>();
  const notifications = new Map<number, DisplayedNotification>();
  const calls = new Map<string, number>();
  const navigation = new Map<string, string>();
  const called = (name: string) => { calls.set(name, (calls.get(name) || 0) + 1); };
  const self = {
    location: { href: `${base}notifications-sw.js` },
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, listener); },
    skipWaiting: () => { called('skipWaiting'); return Promise.resolve(); },
    clients: {
      claim: () => { called('claim'); return Promise.resolve(); },
      matchAll: () => Promise.resolve(existingUrl ? [{ url: existingUrl, focus: () => { called('focus'); return Promise.resolve(); } }] : []),
      openWindow: (url: string) => { navigation.set('opened', url); return Promise.resolve(); },
    },
    registration: {
      showNotification: (title: string, options: Readonly<Record<string, unknown>>) => {
        notifications.set(notifications.size, {
          title, body: options.body, tag: options.tag, icon: options.icon,
          url: (options.data as Readonly<{ url: unknown }>).url,
        });
        return Promise.resolve();
      },
    },
  };
  runInNewContext(source, { self, URL, Date: { now: () => now } }, { filename: 'notifications-sw.js' });
  return {
    dispatch: async (type: string, details: Readonly<Record<string, unknown>> = {}): Promise<void> => {
      pending.clear();
      const listener = listeners.get(type);
      assert.ok(listener, `Missing ${type} event listener`);
      listener({ ...details, waitUntil: (operation: Promise<unknown>) => { pending.set(pending.size, operation); } });
      await Promise.all(pending.values());
    },
    click: async (url: unknown): Promise<void> => {
      pending.clear();
      const listener = listeners.get('notificationclick');
      assert.ok(listener, 'Missing notificationclick event listener');
      listener({ notification: { data: { url }, close: () => { called('close'); } }, waitUntil: (operation: Promise<unknown>) => { pending.set(pending.size, operation); } });
      await Promise.all(pending.values());
    },
    notifications: (): Readonly<Record<number, DisplayedNotification>> => Object.fromEntries(notifications),
    lifetimeCount: () => pending.size,
    callCount: (name: string) => calls.get(name) || 0,
    opened: () => navigation.get('opened'),
  } as const;
}
/* eslint-enable functional/prefer-immutable-types, functional/no-expression-statements, functional/immutable-data, functional/functional-parameters, functional/no-return-void */

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Register an async worker lifecycle integration test with the native test runner.
await test('push worker activates its new handler without waiting for open tabs', async () => {
  const worker = fixture();
  // eslint-disable-next-line functional/no-expression-statements -- Dispatch and await actual installed worker lifecycle callbacks in the VM.
  await worker.dispatch('install');
  // eslint-disable-next-line functional/no-expression-statements -- Verify install extends lifetime for skipWaiting before dispatching activation.
  assert.deepEqual([worker.callCount('skipWaiting'), worker.lifetimeCount()], [1, 1]);
  // eslint-disable-next-line functional/no-expression-statements -- Dispatch and await the installed activation callback.
  await worker.dispatch('activate');
  return assert.deepEqual([worker.callCount('claim'), worker.lifetimeCount()], [1, 1]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Register an async test of the installed push event callback.
await test('push event displays its payload and extends worker lifetime until delivery', async () => {
  const worker = fixture();
  // eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- The native PushMessageData adapter returns decoded JSON to the real worker callback.
  await worker.dispatch('push', { data: { json: () => ({ title: 'Family dinner', body: 'Starts in 10 minutes.', tag: 'event:occurrence', url: `${base}?event=dinner`, targetAt: now + 600_000 } as const) } });
  return assert.deepEqual([worker.lifetimeCount(), worker.notifications()], [1, { 0: { title: 'Family dinner', body: 'Starts in 10 minutes.', tag: 'event:occurrence', icon: `${base}favicon.svg`, url: `${base}?event=dinner` } }]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Register an async test for notifications delayed beyond their occurrence.
await test('push worker suppresses an event that has already started', async () => {
  const worker = fixture();
  // eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Supply expired event JSON through the native message-data boundary.
  await worker.dispatch('push', { data: { json: () => ({ title: 'Expired', targetAt: now } as const) } });
  return assert.deepEqual([worker.lifetimeCount(), worker.notifications()], [1, {}]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Register async tests for the push-message decoding boundary.
await test('empty, malformed, and non-object push messages produce safe visible fallbacks', async () => {
  const empty = fixture(), malformed = fixture(), primitive = fixture();
  // eslint-disable-next-line functional/no-expression-statements -- Complete all independent VM message dispatches before checking the fallback notifications.
  await Promise.all([
    empty.dispatch('push', { data: null }),
    malformed.dispatch('push', { data: { json: JSON.parse.bind(null, 'not-json') } }),
    // eslint-disable-next-line functional/functional-parameters -- Adapt decoded primitive data to the native PushMessageData interface.
    primitive.dispatch('push', { data: { json: () => 'unexpected text' } }),
  ]);
  const fallback: DisplayedNotification = { title: 'Little by little', body: 'Open the app to check your upcoming family events.', tag: 'little-by-little:reminder', icon: `${base}favicon.svg`, url: base };
  return assert.deepEqual([empty.notifications()[0], malformed.notifications()[0], primitive.notifications()[0]], [fallback, fallback, fallback]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Register an async test for untrusted notification-link data.
await test('push worker keeps notification links inside its application scope', async () => {
  const foreign = fixture(), outside = fixture(), malformed = fixture(), credentials = fixture();
  // eslint-disable-next-line functional/no-expression-statements -- Run independent push-handler instances with each hostile or invalid destination.
  await Promise.all([
    // eslint-disable-next-line functional/functional-parameters -- Decode an external-origin URL at the push-message boundary.
    foreign.dispatch('push', { data: { json: () => ({ url: 'https://attacker.example/phishing' } as const) } }),
    // eslint-disable-next-line functional/functional-parameters -- Decode a same-origin URL outside the application scope.
    outside.dispatch('push', { data: { json: () => ({ url: 'https://example.test/other-app/' } as const) } }),
    // eslint-disable-next-line functional/functional-parameters -- Decode a malformed URL to exercise the worker's parsing boundary.
    malformed.dispatch('push', { data: { json: () => ({ url: 'http://[' } as const) } }),
    // eslint-disable-next-line functional/functional-parameters -- Decode a credential-bearing URL that must not become a notification destination.
    credentials.dispatch('push', { data: { json: () => ({ url: 'https://username:password@example.test/progress/' } as const) } }),
  ]);
  return assert.deepEqual([foreign.notifications()[0].url, outside.notifications()[0].url, malformed.notifications()[0].url, credentials.notifications()[0].url], [base, base, base, base]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Register an async test of the native notification-click lifecycle.
await test('notification clicks focus an existing app window and close the notification', async () => {
  const worker = fixture(`${base}?tab=events`);
  // eslint-disable-next-line functional/no-expression-statements -- Invoke and await the installed click handler using a native notification adapter.
  await worker.click(base);
  return assert.deepEqual([worker.callCount('close'), worker.callCount('focus'), worker.opened(), worker.lifetimeCount()], [1, 1, undefined, 1]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Register an async test of opening a closed application from a push notification.
await test('notification clicks open the app when no matching window exists and sanitize the destination again', async () => {
  const worker = fixture('https://example.test/other-app/');
  // eslint-disable-next-line functional/no-expression-statements -- Invoke the real click handler with data that did not pass through the push handler.
  await worker.click('https://attacker.example/');
  return assert.deepEqual([worker.callCount('close'), worker.callCount('focus'), worker.opened(), worker.lifetimeCount()], [1, 0, base, 1]);
});
