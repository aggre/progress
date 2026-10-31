import { webcrypto } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
/** @type {Readonly<Record<number, string>>} */
const args = Object.fromEntries(process.argv.slice(2).entries());
const local = Object.keys(args).length === 1 && args[0] === '--local';
const output = local ? resolve(root, 'apps/api/.dev.vars')
  : Object.keys(args).length === 2 && args[0] === '--output' && args[1] && !args[1].startsWith('--') ? resolve(args[1])
  : null;

/** @param {string} message @returns {never} */
function fail(message) {
  // eslint-disable-next-line functional/no-expression-statements -- Report operator errors without printing generated key material.
  console.error(message);
  // eslint-disable-next-line functional/no-expression-statements -- Stop the CLI after invalid arguments or a failed private-file write.
  process.exit(1);
}

const destination = output ?? fail('Usage: npm run push:keys -- --local | --output work/vapid-secrets.json');

// eslint-disable-next-line functional/no-try-statements -- Cryptographic generation and private-file creation share a sanitized CLI error boundary.
try {
  // eslint-disable-next-line functional/prefer-immutable-types -- Node Web Crypto returns native key handles used only for export here.
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  // eslint-disable-next-line functional/prefer-immutable-types -- Export the native public-key buffer for the uncompressed VAPID key format.
  const publicKey = await webcrypto.subtle.exportKey('raw', pair.publicKey);
  // eslint-disable-next-line functional/prefer-immutable-types -- Read the native JWK export without printing its private-key field.
  const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const privateValue = typeof privateKey.d === 'string' && /^[A-Za-z0-9_-]{43}$/.test(privateKey.d)
    ? privateKey.d : fail('Unable to export a valid VAPID private key.');
  const keys = Object.freeze({ VAPID_PUBLIC_KEY: Buffer.from(publicKey).toString('base64url'), VAPID_PRIVATE_KEY: privateValue });
  const contents = local ? `VAPID_PUBLIC_KEY=${keys.VAPID_PUBLIC_KEY}\nVAPID_PRIVATE_KEY=${keys.VAPID_PRIVATE_KEY}\n` : `${JSON.stringify(keys, null, 2)}\n`;
  // eslint-disable-next-line functional/no-expression-statements -- Create the operator's private output directory before writing the key file.
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  // Exclusive creation prevents accidental rotation and refuses existing files or symlinks.
  // eslint-disable-next-line functional/no-expression-statements -- Persist the generated keys in a new owner-only file; never emit them to the terminal.
  await writeFile(destination, contents, { flag: 'wx', mode: 0o600 });
  // eslint-disable-next-line functional/no-expression-statements -- Report only the destination path, never the generated key values.
  console.log(`VAPID keys written to ${destination}. Keep this file private and retain it for future deployments.`);
} catch (error) {
  // eslint-disable-next-line functional/no-expression-statements -- Convert filesystem/crypto failures to a fixed message that cannot expose key material.
  fail(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'
    ? 'The output file already exists. Refusing to overwrite or rotate VAPID keys.'
    : 'Unable to generate or write VAPID keys. Check the output path and permissions.');
}
