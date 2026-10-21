import type { Context, MiddlewareHandler } from 'hono';
import type { Identity } from '@little/shared/api';
import type { AppEnv } from './types';
export const CHALLENGE_SECONDS=300;
export const SESSION_SECONDS=30*86400;
export function randomToken(bytes=32) { const data=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
export async function hash(value: string) { const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
export function username(value: unknown): string { if(typeof value!=='string')throw new Error('Enter a username.');const name=value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name))throw new Error('Use 3–32 letters, numbers, underscores, or hyphens.');return name; }
export function validId(value: string | undefined): value is string {return typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);}
export function validToken(value: unknown): value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);}
export async function jsonObject(c: Context<AppEnv>): Promise<Record<string,unknown>> {
 if(!c.req.header('Content-Type')?.startsWith('application/json'))throw new Error('Expected JSON.');
 const value: unknown=await c.req.json();if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a JSON object.');return value as Record<string,unknown>;
}
export async function throttle(c: Context<AppEnv>,scope: string,limit: number,period=60,identifier?:string){
 const now=Math.floor(Date.now()/1000),window=Math.floor(now/period);
 const key=`${scope}:${await hash(identifier||c.req.header('CF-Connecting-IP')||'local')}:${window}`;
 const row=await c.env.DB.prepare('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,(window+1)*period).first<{count:number}>();
 return !!row&&row.count<=limit;
}
export const requireAuth:MiddlewareHandler<AppEnv>=async(c,next)=>{
 const auth=c.req.header('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
 if(!auth)return c.json({error:'Please log in to continue.'},401);
 const tokenHash=await hash(auth[1]);
 const row=await c.env.DB.prepare('SELECT u.id,u.username,u.family_id,f.name AS family_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN families f ON f.id=u.family_id WHERE s.token_hash=? AND s.expires_at>unixepoch()').bind(tokenHash).first<{id:string;username:string;family_id:string;family_name:string}>();
 if(!row)return c.json({error:'Your session has expired. Please log in again.'},401);
 const identity:Identity={user:{id:row.id,username:row.username,familyId:row.family_id},family:{id:row.family_id,name:row.family_name}};
 c.set('identity',identity);c.set('sessionHash',tokenHash);await next();
};
