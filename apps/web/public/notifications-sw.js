/// <reference lib="webworker" />

// eslint-disable-next-line functional/prefer-immutable-types -- Bind the service worker global at the browser lifecycle boundary.
const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

// eslint-disable-next-line functional/prefer-immutable-types -- Update an already-installed notification worker without waiting for every application tab to close.
worker.addEventListener('install', event => { event.waitUntil(worker.skipWaiting()); });
// eslint-disable-next-line functional/prefer-immutable-types -- Claim the application's windows after the push handler becomes active.
worker.addEventListener('activate', event => { event.waitUntil(worker.clients.claim()); });
// eslint-disable-next-line functional/prefer-immutable-types -- Activation requests come from the scoped application during a subscription update.
worker.addEventListener('message', event => { void (object(event.data).type === 'SKIP_WAITING' && event.waitUntil(worker.skipWaiting())); });

/** @param {unknown} value */
function object(value) { return value && typeof value === 'object' ? /** @type {Readonly<Record<string, unknown>>} */ (value) : {}; }

/** @param {unknown} value */
function notificationUrl(value) {
  // eslint-disable-next-line functional/prefer-immutable-types -- Parse the native worker URL to enforce this application's navigation scope.
  const base = new URL('./', worker.location.href);
  // eslint-disable-next-line functional/no-try-statements -- Payload URLs are untrusted browser data and may fail URL parsing.
  try {
    // eslint-disable-next-line functional/prefer-immutable-types -- Parse the untrusted URL before allowing browser navigation.
    const url = new URL(typeof value === 'string' ? value : base.href, base);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) && !url.username && !url.password ? url.href : base.href;
  } catch { return base.href; }
}

/** @param {PushMessageData | null} data */
// eslint-disable-next-line functional/prefer-immutable-types -- Decode the native push-message payload at the service worker boundary.
function payload(data) {
  // eslint-disable-next-line functional/no-try-statements -- Malformed or empty push messages still produce a safe visible notification.
  try { return object(data ? data.json() : null); } catch { return {}; }
}

// eslint-disable-next-line functional/prefer-immutable-types -- The native push event keeps this worker alive until its notification has been displayed.
worker.addEventListener('push', event => {
  const value = payload(event.data);
  const expired = typeof value.targetAt === 'number' && Number.isFinite(value.targetAt) && value.targetAt <= Date.now();
  // eslint-disable-next-line functional/prefer-immutable-types -- Resolve the notification icon relative to the native service worker scope.
  const base = new URL('./', worker.location.href);
  event.waitUntil(expired ? Promise.resolve() : worker.registration.showNotification(
    typeof value.title === 'string' && value.title.trim() ? value.title.slice(0, 150) : 'Little by little',
    {
      body: typeof value.body === 'string' && value.body.trim() ? value.body.slice(0, 500) : 'Open the app to check your upcoming family events.',
      tag: typeof value.tag === 'string' ? value.tag.slice(0, 240) : 'little-by-little:reminder',
      icon: new URL('favicon.svg', base).href,
      data: { url: notificationUrl(value.url) },
    },
  ));
});

// eslint-disable-next-line functional/prefer-immutable-types -- Handle the native service worker notification click event.
worker.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = notificationUrl(object(event.notification.data).url);
  // eslint-disable-next-line functional/prefer-immutable-types -- Window clients and their focus promises belong to the browser lifecycle.
  event.waitUntil(worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    // eslint-disable-next-line functional/prefer-immutable-types -- Select a native window client to focus when the notification is clicked.
    const existing = clients.find(client => new URL(client.url).origin === new URL(url).origin && new URL(client.url).pathname === new URL(url).pathname);
    return existing ? existing.focus() : worker.clients.openWindow(url);
  }));
});
