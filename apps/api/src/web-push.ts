import { buildPushPayload } from '@block65/webcrypto-web-push';

export interface WebPushSubscription {
  readonly endpoint: string;
  readonly keys: Readonly<{ p256dh: string; auth: string }>;
}
export interface WebPushConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

/** Only browser push services may receive outbound subscription requests. */
export function isSafePushEndpoint(endpoint: string): boolean {
  const { protocol, hostname, port, username, password, hash, pathname } = new URL(URL.canParse(endpoint) ? endpoint : 'about:blank');
  return endpoint.length <= 4096 && protocol === 'https:' && !port && !username && !password && !hash && pathname !== '/'
    && (hostname === 'fcm.googleapis.com' || hostname === 'updates.push.services.mozilla.com'
      || hostname === 'web.push.apple.com' || hostname.endsWith('.notify.windows.com'));
}

// eslint-disable-next-line functional/prefer-immutable-types -- Web Crypto encryption and the outbound push-service request complete through native promises.
export async function sendWebPush(subscription: WebPushSubscription, payload: string, config: WebPushConfig, ttl: number): Promise<Readonly<{ status: number }>> {
  // eslint-disable-next-line functional/no-conditional-statements, functional/no-throw-statements, functional/no-promise-reject -- Refuse unsafe outbound destinations even if a stored subscription bypassed HTTP validation.
  if (!isSafePushEndpoint(subscription.endpoint)) throw new Error('Invalid push service endpoint.');
  // eslint-disable-next-line functional/prefer-immutable-types -- The library returns the native encrypted byte buffer and HTTP request headers.
  const request = await buildPushPayload({ data: payload, options: { ttl: Math.max(1, Math.min(86400, Math.floor(ttl))), urgency: 'high' } }, { ...subscription, expirationTime: null }, config);
  // eslint-disable-next-line functional/prefer-immutable-types -- Read only the native push-service HTTP status; never consume or log service response bodies.
  const response = await fetch(subscription.endpoint, { ...request, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  // eslint-disable-next-line functional/no-expression-statements -- Release an unread response stream at the outbound HTTP boundary.
  await response.body?.cancel();
  return { status: response.status };
}
