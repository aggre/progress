import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { authenticate } from '../server/auth';
const env={ACCESS_AUD:'e883ad53762c905f0f30bcc2c318e331ce977781799095dc87f184f051132843',ALLOWED_EMAIL:'hiroyuki.aggre@gmail.com'} as const;
const issuer='https://morning-wildflower-98d1.cloudflareaccess.com';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const resolver=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
async function token(email=env.ALLOWED_EMAIL as string,aud=env.ACCESS_AUD as string,exp='1h',iss=issuer){return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuedAt().setExpirationTime(exp).setSubject('test-user').setAudience(aud).setIssuer(iss).sign(privateKey);}
function request(jwt?:string){return new Request('https://little-by-little-aggre.pages.dev/api/events',{headers:jwt ? {'Cf-Access-Jwt-Assertion':jwt} : {'Cf-Access-Authenticated-User-Email':env.ALLOWED_EMAIL}});}
test('accepts the authorized email with a valid signature and audience',async()=>{assert.equal(await authenticate(request(await token()),env,resolver),env.ALLOWED_EMAIL);});
test('rejects missing, forged, expired and wrong-audience/issuer tokens',async()=>{
  assert.equal(await authenticate(request(),env,resolver),null);
  for(const jwt of ['forged',await token('intruder@example.com'),await token(env.ALLOWED_EMAIL,'wrong-app'),await token(env.ALLOWED_EMAIL,env.ACCESS_AUD,'-1h'),await token(env.ALLOWED_EMAIL,env.ACCESS_AUD,'1h','https://wrong-issuer.example')]) assert.equal(await authenticate(request(jwt),env,resolver),null);
});
