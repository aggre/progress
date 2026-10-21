import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
const issuer = 'https://morning-wildflower-98d1.cloudflareaccess.com';
// This cache contains public signing keys only, never session or user data.
const keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
export async function authenticate(request: Request, env: Pick<Env, 'ACCESS_AUD' | 'ALLOWED_EMAIL'>, resolver: JWTVerifyGetKey = keys): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_AUD || !env.ALLOWED_EMAIL) return null;
  try {
    const { payload } = await jwtVerify(token, resolver, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'] });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    return email === env.ALLOWED_EMAIL.toLowerCase() ? email : null;
  } catch { return null; }
}
