import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { isSafePushEndpoint, type WebPushConfig, type WebPushSubscription } from '../src/web-push';

const script = (await build({ stdin: { resolveDir: process.cwd(), contents: `
  import { sendWebPush } from './apps/api/src/web-push';
  export default { async fetch(request) {
    const input = await request.json();
    try { return Response.json(await sendWebPush(input.subscription, input.payload, input.config, input.ttl)); }
    catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
  } };
` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })).outputFiles[0].text;

// eslint-disable-next-line functional/functional-parameters -- Generate fresh ephemeral test keys at the cryptographic test-fixture boundary.
function keyPair() {
  // eslint-disable-next-line functional/prefer-immutable-types -- The native ECDH handle creates and exports test key material.
  const key = createECDH('prime256v1');
  const publicKey = key.generateKeys().toString('base64url');
  return { publicKey, privateKey: key.getPrivateKey().toString('base64url') } as const;
}

const client = keyPair();
const config: WebPushConfig = { ...keyPair(), subject: 'https://app.example' };
const subscription: WebPushSubscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-recipient', keys: { p256dh: client.publicKey, auth: randomBytes(16).toString('base64url') } };
type CapturedRequest = Readonly<{ url: string; method: string; headers: Readonly<Record<string, string>>; body: string }>;

// eslint-disable-next-line functional/prefer-immutable-types -- The test fixture starts an isolated native Worker runtime and registers its lifecycle cleanup.
function fixture(t: TestContext, status = 201) {
  // eslint-disable-next-line functional/no-let -- Capture the latest intercepted native HTTP request before completing its response.
  let captured: CapturedRequest | null = null;
  // eslint-disable-next-line functional/no-let -- Count intercepted native network operations to detect unexpected redirect following.
  let count = 0;
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native Miniflare environment to exercise the production transport in workerd.
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'web-push-test', modules: true, script, compatibilityDate: '2026-10-21', compatibilityFlags: ['nodejs_compat'],
    // eslint-disable-next-line functional/prefer-immutable-types -- The native test HTTP interceptor captures the encrypted request and returns a synthetic push-service response.
    outboundService: async request => {
      // eslint-disable-next-line functional/no-expression-statements -- Record that the isolated Worker reached the mock HTTP boundary.
      count += 1;
      // eslint-disable-next-line functional/no-expression-statements -- Record the request after consuming its bounded encrypted test payload.
      captured = { url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body: Buffer.from(await request.arrayBuffer()).toString('base64') };
      return new Response(null, { status, ...(status === 302 ? { headers: { Location: 'https://attacker.example/redirect-target' } } : {}) });
    },
  }));
  // eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Dispose the native Worker runtime after this test completes.
  t.after(() => mf.dispose());
  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Expose the native HTTP test dispatch operation and a read of the network counter.
  return { captured: () => captured, count: () => count, send: (input: WebPushSubscription, ttl = 120, payload = 'A private family reminder') => mf.dispatchFetch('https://test.example/', { method: 'POST', body: JSON.stringify({ subscription: input, payload, config, ttl }) }) } as const;
}

function decodedJwt(authorization: string): Readonly<{ header: Readonly<{ alg: string; typ: string }>; claims: Readonly<{ aud: string; sub: string; exp: number }>; verified: boolean }> {
  const token = authorization.match(/^vapid t=([^,]+), k=/)?.[1] || '';
  const [header, payload, signature] = token.split('.');
  // eslint-disable-next-line functional/prefer-immutable-types -- Decode the native P-256 public-key bytes for independent signature verification.
  const publicBytes = Buffer.from(config.publicKey, 'base64url');
  // eslint-disable-next-line functional/prefer-immutable-types -- Import the public test key using Node's independent crypto implementation.
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: publicBytes.subarray(1, 33).toString('base64url'), y: publicBytes.subarray(33).toString('base64url') }, format: 'jwk' });
  return { header: JSON.parse(Buffer.from(header, 'base64url').toString()) as Readonly<{ alg: string; typ: string }>, claims: JSON.parse(Buffer.from(payload, 'base64url').toString()) as Readonly<{ aud: string; sub: string; exp: number }>, verified: verify('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')) };
}

function decryptBody(body: string): string {
  // eslint-disable-next-line functional/prefer-immutable-types -- Parse the received RFC 8188 record at the native cryptographic test boundary.
  const bytes = Buffer.from(body, 'base64');
  // eslint-disable-next-line functional/prefer-immutable-types -- Recreate the recipient's native ECDH key for independent RFC 8291 decryption.
  const key = createECDH('prime256v1');
  // eslint-disable-next-line functional/no-expression-statements -- Import only the ephemeral private test key into the native ECDH handle.
  key.setPrivateKey(Buffer.from(client.privateKey, 'base64url'));
  // eslint-disable-next-line functional/prefer-immutable-types -- HKDF derives native byte buffers independently of the Web Push library.
  const ikm = hkdfSync('sha256', key.computeSecret(bytes.subarray(21, 86)), Buffer.from(subscription.keys.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(client.publicKey, 'base64url'), bytes.subarray(21, 86)]), 32);
  // eslint-disable-next-line functional/prefer-immutable-types -- Reconstruct the native AES-128-GCM decipher using the RFC 8291 content key and nonce.
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', ikm, bytes.subarray(0, 16), Buffer.from('Content-Encoding: aes128gcm\0'), 16)), Buffer.from(hkdfSync('sha256', ikm, bytes.subarray(0, 16), Buffer.from('Content-Encoding: nonce\0'), 12)));
  // eslint-disable-next-line functional/no-expression-statements -- Supply the received authentication tag to the native decipher.
  decipher.setAuthTag(bytes.subarray(-16));
  // eslint-disable-next-line functional/prefer-immutable-types -- Decode the authenticated plaintext and discard only the RFC 8188 delimiter and padding.
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(86, -16)), decipher.final()]);
  const delimiter = plaintext.lastIndexOf(2);
  return plaintext[delimiter] === 2 ? plaintext.subarray(0, delimiter).toString('utf8') : 'Invalid final-record delimiter';
}

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register URL validation assertions with the test runner lifecycle.
await test('push endpoints allow only HTTPS browser services, without credentials, fragments or custom ports', () => {
  return assert.deepEqual([
    'https://fcm.googleapis.com/fcm/send/id', 'https://updates.push.services.mozilla.com/wpush/v2/id',
    'https://web.push.apple.com/id', 'https://wns2-test.notify.windows.com/w/?token=id',
    'http://fcm.googleapis.com/fcm/send/id', 'https://fcm.googleapis.com.attacker.example/id',
    'https://attacker.example/fcm.googleapis.com', 'https://user:password@fcm.googleapis.com/id',
    'https://fcm.googleapis.com:444/id', 'https://fcm.googleapis.com/id#fragment',
    'https://127.0.0.1/id', 'https://[::1]/id', 'https://fcm.googleapis.com/', 'not a URL',
  ].map(isSafePushEndpoint), [true, true, true, true, false, false, false, false, false, false, false, false, false, false]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Run the encrypted outbound request inside workerd and independently verify its cryptography.
await test('workerd sends decryptable aes128gcm payloads with a valid origin-bound VAPID signature', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native test fixture handles and outbound dispatch response.
  const f = fixture(t), response = await f.send(subscription);
  // eslint-disable-next-line functional/no-expression-statements -- Fail before reading the capture if encryption or Worker execution failed.
  assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
  const sent = f.captured()!;
  const jwt = decodedJwt(sent.headers.authorization);
  return assert.deepEqual([
    await response.json(), sent.url, sent.method, sent.headers.ttl, sent.headers.urgency, sent.headers['content-encoding'],
    Buffer.from(sent.body, 'base64').length, Buffer.from(sent.body, 'base64').readUInt32BE(16), Buffer.from(sent.body, 'base64')[20],
    decryptBody(sent.body), jwt.header, jwt.claims.aud, jwt.claims.sub, jwt.verified,
    jwt.claims.exp > Date.now() / 1000, jwt.claims.exp <= Date.now() / 1000 + 86400,
    sent.headers.authorization.endsWith(`k=${config.publicKey}`),
  ], [{ status: 201 }, subscription.endpoint, 'POST', '120', 'high', 'aes128gcm', 4096, 4096, 65, 'A private family reminder', { typ: 'JWT', alg: 'ES256' }, 'https://fcm.googleapis.com', config.subject, true, true, true, true]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Verify that an expired push subscription status remains visible to the scheduler.
await test('push-service expiry status is returned and TTL cannot extend beyond one day', async t => {
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native test fixture and HTTP response handles.
  const f = fixture(t, 410), response = await f.send(subscription, 999999);
  // eslint-disable-next-line functional/no-expression-statements -- Confirm the Worker completed before reading the captured request.
  assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
  return assert.deepEqual([await response.json(), f.captured()?.headers.ttl], [{ status: 410 }, '86400']);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Exercise redirect rejection at the real Worker fetch boundary.
await test('push requests never follow redirects to another destination', async t => {
  const f = fixture(t, 302);
  return assert.deepEqual([await (await f.send(subscription)).json(), f.count()], [{ status: 302 }, 1]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Ensure invalid recipients cannot issue any outbound HTTP request from workerd.
await test('unsafe endpoints and invalid encryption keys are rejected before network delivery', async t => {
  const f = fixture(t);
  return assert.deepEqual([
    (await f.send({ ...subscription, endpoint: 'https://attacker.example/collect' })).status,
    (await f.send({ ...subscription, keys: { ...subscription.keys, auth: 'invalid' } })).status,
    f.count(),
  ], [400, 400, 0]);
});
