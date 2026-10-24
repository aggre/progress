import type { Context, MiddlewareHandler } from 'hono';
import type { Identity } from '@little/shared/api';
import type { AppEnv } from './types';
export const CHALLENGE_SECONDS=300;
export const SESSION_SECONDS=30*86400;
export function randomToken(bytes=32) { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
// eslint-disable-next-line functional/prefer-immutable-types -- Web Crypto completes hashing through its native Promise at this cryptographic API boundary.
export async function hash(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function invalidInput(message: string): never { throw new Error(message); }
export function username(value: unknown): string {
 const name=typeof value==='string' ? value.trim().toLowerCase() : invalidInput('Enter a username.');
 return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(name) ? name : invalidInput('Use 3–32 letters, numbers, underscores, or hyphens.');
}
export function memberUsername(data:Readonly<Record<string,unknown>>):string {
 return Object.keys(data).some(k=>k!=='username') ? invalidInput('Only a username is accepted.') : username(data.username);
}
export function validId(value: string | undefined): value is string {return typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);}
export function validToken(value: unknown): value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);}
export async function jsonObject(c: Context<AppEnv>): Promise<Readonly<Record<string,unknown>>> {
 const value: unknown=c.req.header('Content-Type')?.startsWith('application/json')
  ? await c.req.json() : invalidInput('Expected JSON.');
 return value&&typeof value==='object'&&!Array.isArray(value)
  ? value as Readonly<Record<string,unknown>> : invalidInput('Expected a JSON object.');
}
// eslint-disable-next-line functional/prefer-immutable-types -- Read the native Hono request context and return the D1 rate-limit operation completion Promise.
export async function throttle(c: Context<AppEnv>,scope: string,limit: number,period=60,identifier?:string){
 const now=Math.floor(Date.now()/1000),window=Math.floor(now/period);
 const key=`${scope}:${await hash(identifier||c.req.header('CF-Connecting-IP')||'local')}:${window}`;
 const row=await c.env.DB.prepare('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,(window+1)*period).first<Readonly<{count:number}>>();
 return !!row&&row.count<=limit;
}
export const requireAuth:MiddlewareHandler<AppEnv>=async(c,next)=>{
 const token=c.req.header('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 if(!token)return c.json({error:'Please log in to continue.'},401);
 const tokenHash=await hash(token);
 const row=await c.env.DB.prepare('SELECT u.id,u.username,u.family_id,f.name AS family_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN families f ON f.id=u.family_id WHERE s.token_hash=? AND s.expires_at>unixepoch()').bind(tokenHash).first<Readonly<{id:string;username:string;family_id:string;family_name:string}>>();
 if(!row)return c.json({error:'Your session has expired. Please log in again.'},401);
 const identity:Readonly<{user:Readonly<Identity['user']>;family:Identity['family']}>={user:{id:row.id,username:row.username,familyId:row.family_id},family:{id:row.family_id,name:row.family_name}};
 // eslint-disable-next-line functional/no-expression-statements -- Store the verified identity in the current Hono request context.
 c.set('identity',identity);
 // eslint-disable-next-line functional/no-expression-statements -- Store the verified session hash in the current Hono request context for logout.
 c.set('sessionHash',tokenHash);
 // eslint-disable-next-line functional/no-expression-statements -- Dispatch the authenticated request to downstream Hono middleware.
 await next();
};
