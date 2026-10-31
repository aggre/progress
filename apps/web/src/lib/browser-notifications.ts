import { api, getSession } from './api';
import { parsePreferences, type ReminderMinutes, type ReminderPreferences } from './reminders';

export type BrowserPermission = NotificationPermission | 'unsupported';
export interface PushConfiguration { readonly configured: boolean; readonly publicKey: string | null; }
export interface PushStatus { readonly subscribed: boolean; readonly minutes: number | null; }

// eslint-disable-next-line functional/functional-parameters -- Read browser capabilities without prompting for permission.
export function notificationPermission(): BrowserPermission {
  return typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
    ? Notification.permission : 'unsupported';
}

export function readPreferences(key: string): ReminderPreferences {
  // eslint-disable-next-line functional/no-try-statements -- Browser storage may be unavailable or contain malformed saved preferences.
  try { return parsePreferences(JSON.parse(localStorage.getItem(key) || 'null') as unknown); }
  catch { return parsePreferences(null); }
}

export function writePreferences(key: string, preferences: ReminderPreferences): boolean {
  // eslint-disable-next-line functional/no-try-statements -- Server subscription state remains authoritative when local preference storage is unavailable.
  try { localStorage.setItem(key, JSON.stringify(preferences)); return true; }
  catch { return false; }
}

// eslint-disable-next-line functional/no-throw-statements, functional/functional-parameters -- Reject obsolete browser operations before registering a subscription for a different sign-in.
function cancelled(): never { throw new Error('Your sign-in changed. Please try again.'); }
function requireCurrent(token: string, isCurrent: () => boolean) { return getSession() === token && isCurrent() ? undefined : cancelled(); }

// eslint-disable-next-line functional/prefer-immutable-types -- Browser key conversion produces the native BufferSource required by PushManager.
function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
}

// eslint-disable-next-line functional/prefer-immutable-types -- Compare the browser's native subscription key buffer against the configured VAPID public key.
export function pushKeyMatches(subscription: PushSubscription, publicKey: string): boolean {
  // eslint-disable-next-line functional/prefer-immutable-types -- PushManager exposes its application key as a native ArrayBuffer.
  const previousKey = subscription.options.applicationServerKey;
  // eslint-disable-next-line functional/prefer-immutable-types -- Decode the configured public key into the native buffer representation.
  const key = applicationKey(publicKey);
  return !!previousKey && previousKey.byteLength === key.byteLength && new Uint8Array(previousKey).every((byte, index) => byte === key[index]);
}

// eslint-disable-next-line functional/prefer-immutable-types -- Watch the native worker lifecycle and release its timer and listener after activation.
function activated(serviceWorker: ServiceWorker): Promise<void> {
  // eslint-disable-next-line functional/no-promise-reject -- Reject failed native worker activation rather than leave subscription controls pending forever.
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line functional/prefer-immutable-types -- Retain the timeout handle for lifecycle cleanup.
    const timeout = setTimeout(() => { serviceWorker.removeEventListener('statechange', changed); reject(new Error('The notification service did not start. Reload the app and try again.')); }, 12_000);
    // eslint-disable-next-line functional/functional-parameters -- Read the native worker state when its lifecycle advances.
    const changed = () => {
      void ((serviceWorker.state === 'activated' || serviceWorker.state === 'redundant') && (clearTimeout(timeout), serviceWorker.removeEventListener('statechange', changed)));
      void (serviceWorker.state === 'activated' ? resolve() : serviceWorker.state === 'redundant' && reject(new Error('The notification service could not start. Reload the app and try again.')));
    };
    serviceWorker.addEventListener('statechange', changed);
    serviceWorker.postMessage({ type: 'SKIP_WAITING' });
    changed();
  });
}

// eslint-disable-next-line functional/prefer-immutable-types -- Register and activate the scoped browser worker before creating a push subscription.
export async function pushRegistration(basePath: string): Promise<ServiceWorkerRegistration> {
  // eslint-disable-next-line functional/prefer-immutable-types -- Native registration owns worker activation and PushManager.
  const registration = await navigator.serviceWorker.register(`${basePath}notifications-sw.js`, { scope: basePath });
  // eslint-disable-next-line functional/prefer-immutable-types -- Wait for an installing or waiting worker instead of resolving to an older active script.
  const pending = registration.installing || registration.waiting;
  void (pending && await activated(pending));
  // eslint-disable-next-line functional/no-conditional-statements, functional/no-throw-statements, functional/no-promise-reject -- A registration without an active worker cannot accept a push subscription.
  if (!registration.active) throw new Error('The notification service is not active. Reload the app and try again.');
  return registration;
}

// eslint-disable-next-line functional/prefer-immutable-types -- Inspect an existing browser subscription without creating one or prompting.
export async function currentPushSubscription(basePath: string): Promise<PushSubscription | null> {
  // eslint-disable-next-line functional/prefer-immutable-types -- Read the native registration only for this application's scope.
  const registration = await navigator.serviceWorker.getRegistration(basePath);
  return registration?.scope === new URL(basePath, location.origin).href ? registration.pushManager.getSubscription() : null;
}

// eslint-disable-next-line functional/prefer-immutable-types -- Send the browser push endpoint and public encryption keys to the authenticated API.
async function savePushSubscription(subscription: PushSubscription, minutes: ReminderMinutes, token: string): Promise<void> {
  // eslint-disable-next-line functional/prefer-immutable-types -- Serialize the native browser push subscription at the HTTP boundary.
  const data = subscription.toJSON();
  await api('/api/push/subscription', 'PUT', { subscription: { endpoint: subscription.endpoint, keys: data.keys }, minutes }, token);
}

// eslint-disable-next-line functional/prefer-immutable-types -- Serialize subscription mutations across tabs using the native Web Locks promise.
async function withSubscriptionLock<T>(basePath: string, action: () => Promise<T>): Promise<T> {
  return 'locks' in navigator ? navigator.locks.request(`little-by-little:push:${basePath}`, action) : action();
}

// eslint-disable-next-line functional/prefer-immutable-types -- Create a browser subscription and persist it for the captured authenticated session.
export async function enablePush(basePath: string, publicKey: string, minutes: ReminderMinutes, token: string, isCurrent: () => boolean): Promise<void> {
  // eslint-disable-next-line functional/prefer-immutable-types -- The lock callback returns its native browser and HTTP operation promise.
  return withSubscriptionLock(basePath, async () => {
    requireCurrent(token, isCurrent);
    // eslint-disable-next-line functional/prefer-immutable-types -- Native worker registration owns PushManager operations.
    const registration = await pushRegistration(basePath);
    requireCurrent(token, isCurrent);
    // eslint-disable-next-line functional/prefer-immutable-types -- Inspect and replace the native subscription only at the browser boundary.
    let subscription = await registration.pushManager.getSubscription();
    // eslint-disable-next-line functional/prefer-immutable-types -- PushManager requires an ArrayBuffer-backed application server public key.
    const key = applicationKey(publicKey);
    const status = subscription ? await api<PushStatus>('/api/push/status', 'POST', { endpoint: subscription.endpoint }, token) : null;
    // eslint-disable-next-line functional/no-conditional-statements -- Rotate subscriptions left by another sign-in or bound to an older application server key.
    if (subscription && (!status?.subscribed || !pushKeyMatches(subscription, publicKey))) {
      requireCurrent(token, isCurrent);
      await api('/api/push/subscription', 'DELETE', { endpoint: subscription.endpoint }, token);
      requireCurrent(token, isCurrent);
      const removed = await subscription.unsubscribe();
      // eslint-disable-next-line functional/no-conditional-statements, functional/no-throw-statements, functional/no-promise-reject -- Refuse to register a still-active subscription tied to an obsolete server key or another sign-in.
      if (!removed && await registration.pushManager.getSubscription()) throw new Error('Unable to replace this browser subscription. Revoke notification permission in browser settings, then try again.');
      subscription = null;
    }
    const created = !subscription;
    // eslint-disable-next-line functional/no-try-statements -- Roll back a new browser subscription if server registration fails or sign-in changes.
    try {
      requireCurrent(token, isCurrent);
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      requireCurrent(token, isCurrent);
      await savePushSubscription(subscription, minutes, token);
      requireCurrent(token, isCurrent);
    } catch (error) {
      void (created && subscription && token === getSession() && await subscription.unsubscribe().catch(() => false));
      // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject -- Preserve the browser or HTTP failure for the settings UI.
      throw error;
    }
  });
}

// eslint-disable-next-line functional/prefer-immutable-types -- Remove the server subscription before completing native browser unsubscription.
export async function disablePush(basePath: string, token: string): Promise<boolean> {
  // eslint-disable-next-line functional/prefer-immutable-types -- The lock callback returns the native unsubscribe completion promise.
  return withSubscriptionLock(basePath, async () => {
    requireCurrent(token, () => true);
    await api('/api/push/subscription', 'DELETE', {}, token);
    requireCurrent(token, () => true);
    // eslint-disable-next-line functional/prefer-immutable-types -- Read the native subscription to remove this browser's server registration.
    const subscription = await currentPushSubscription(basePath);
    requireCurrent(token, () => true);
    // eslint-disable-next-line functional/no-conditional-statements -- An absent browser subscription is already disabled.
    if (!subscription) return true;
    return subscription.unsubscribe().catch(() => false);
  });
}

// eslint-disable-next-line functional/prefer-immutable-types -- Serialize reminder-time changes with browser subscription enable and disable operations.
export async function updatePushTime(basePath: string, minutes: ReminderMinutes, token: string, isCurrent: () => boolean): Promise<boolean> {
  // eslint-disable-next-line functional/prefer-immutable-types -- The cross-tab lock callback returns the browser and API completion promise.
  return withSubscriptionLock(basePath, async () => {
    requireCurrent(token, isCurrent);
    // eslint-disable-next-line functional/prefer-immutable-types -- Re-read the native subscription after acquiring the mutation lock.
    const subscription = await currentPushSubscription(basePath);
    requireCurrent(token, isCurrent);
    // eslint-disable-next-line functional/no-conditional-statements -- Clean stale server registration when the browser no longer has its subscription.
    if (!subscription) { await api('/api/push/subscription', 'DELETE', {}, token); return false; }
    await savePushSubscription(subscription, minutes, token);
    requireCurrent(token, isCurrent);
    return true;
  });
}

// eslint-disable-next-line functional/prefer-immutable-types -- Sign-out can revoke browser push even if the API is temporarily unreachable.
export async function unsubscribeBrowserPush(basePath: string): Promise<boolean> {
  const token = getSession();
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the cleanup timeout so logout cannot wait indefinitely on the browser push service.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // eslint-disable-next-line functional/prefer-immutable-types -- Browser cleanup runs under a native cross-tab lock and is bounded by a logout timeout.
  const cleanup = notificationPermission() === 'unsupported' ? Promise.resolve(true) : withSubscriptionLock(basePath, async () => {
    // eslint-disable-next-line functional/prefer-immutable-types -- Unsubscribe through the browser push service without exposing endpoint or keys.
    const subscription = await currentPushSubscription(basePath);
    return subscription && token === getSession() ? subscription.unsubscribe() : true;
  });
  return Promise.race([cleanup, new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 5000); })]).finally(() => { clearTimeout(timeout); });
}
