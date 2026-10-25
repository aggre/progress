import { Hono } from 'hono';
import { always, prop } from 'ramda';
import { CHALLENGE_SECONDS,hash,jsonObject,randomToken,requireAuth,throttle,username,validId,validToken } from './security';
import type { AppEnv } from './types';
interface Challenge { readonly id:string; readonly username:string; readonly poll_hash:string; readonly approval_hash:string; readonly session_hash:string; readonly verification_code:string; readonly status:'pending'|'approved'; readonly expires_at:number; readonly target_id:string; readonly family_id:string; }
// eslint-disable-next-line functional/prefer-immutable-types -- Retain the native Hono router instance to register authentication HTTP handlers.
export const auth=new Hono<AppEnv>();
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the login challenge HTTP endpoint using the native Hono request context and D1/response completion Promise.
auth.post('/challenges',async c=>{
 // eslint-disable-next-line functional/no-conditional-statements -- Respond to the D1 throttle decision before consuming another HTTP request body.
 if(!await throttle(c,'start',8))return c.json({error:'Too many login attempts. Please wait a minute.'},429);
 const name=await jsonObject(c).then(prop('username')).then(username)
  .catch((e:unknown):Readonly<{error:string}>=>({error:e instanceof Error?e.message:'Invalid username.'}));
 // eslint-disable-next-line functional/no-conditional-statements -- Translate the username validation outcome and D1 throttle decision into an HTTP response before persistence.
 if(typeof name!=='string'||!await throttle(c,'username-start',8,60,name))return typeof name!=='string'
  ? c.json(name,400) : c.json({error:'Too many login attempts. Please wait a minute.'},429);
 const id=crypto.randomUUID(),pollToken=randomToken(),approvalToken=randomToken(),sessionToken=randomToken(),verificationCode=randomToken(5).slice(0,6).toUpperCase();
 const now=Math.floor(Date.now()/1000),expiresAt=now+CHALLENGE_SECONDS;
 // Do not look up the username here: registered and unknown names have the same response.
 const {meta:{changes}}:Readonly<{meta:Readonly<{changes:number}>}>=await c.env.DB.prepare('INSERT INTO login_challenges (id,username,poll_hash,approval_hash,session_hash,verification_code,created_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM login_challenges WHERE expires_at>?)<1000').bind(id,name,await hash(pollToken),await hash(approvalToken),await hash(sessionToken),verificationCode,now,expiresAt,now).run();
 return !changes ? c.json({error:'Please try again later.'},429)
  : c.json({id,pollToken,sessionToken,approvalToken,expiresAt:expiresAt*1000,pollInterval:3000,verificationCode},201);
});
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the login polling HTTP endpoint using the native Hono request context and D1/response completion Promise.
auth.post('/challenges/:id/poll',async c=>{
 const allowed=await throttle(c,'poll',240);
 const id=allowed ? c.req.param('id') : undefined;
 const input=allowed ? await jsonObject(c).catch(always(null)) : null;
 const pollToken=input?.pollToken;
 const valid=!!input&&validId(id)&&validToken(pollToken);
 const row=valid ? await c.env.DB.prepare('SELECT status,expires_at FROM login_challenges WHERE id=? AND poll_hash=?').bind(id,await hash(pollToken)).first<Readonly<{status:string;expires_at:number}>>() : null;
 return !allowed ? c.json({error:'Please slow down.'},429)
  : !valid ? c.json({error:'Invalid login request.'},400)
  : !row ? c.json({error:'Login request not found.'},404)
  : row.expires_at<=Math.floor(Date.now()/1000) ? c.json({status:'expired'})
  : c.json({status:row.status});
});
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the session logout HTTP endpoint using the native Hono request context and D1/response completion Promise.
auth.post('/logout',requireAuth,async c=>{
 // eslint-disable-next-line functional/no-expression-statements -- Invalidate the authenticated session in D1 at the logout persistence boundary.
 await c.env.DB.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(c.get('sessionHash')).run();
 return c.json({ok:true});
});
// eslint-disable-next-line functional/prefer-immutable-types -- Read the native Hono request context and return the D1 approval lookup completion Promise.
async function approval(c: Parameters<typeof jsonObject>[0]) {
 const id=c.req.param('id');const input:Readonly<Record<string,unknown>>=await jsonObject(c);
 return !validId(id)||!validToken(input.approvalToken) ? null
  : c.env.DB.prepare('SELECT l.*,u.id AS target_id,u.family_id FROM login_challenges l JOIN users u ON u.username=l.username COLLATE NOCASE WHERE l.id=? AND l.approval_hash=? AND u.family_id=? AND l.expires_at>unixepoch()').bind(id,await hash(input.approvalToken),c.get('identity').family.id).first<Challenge>();
}
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the approval inspection HTTP endpoint using the native Hono request context and D1/response completion Promise.
auth.post('/challenges/:id/inspect',requireAuth,async c=>{
 const allowed=await throttle(c,'inspect',60);
 const row=allowed ? await approval(c).catch(always(undefined)) : null;
 return !allowed ? c.json({error:'Please slow down.'},429)
  : row===undefined ? c.json({error:'Invalid approval request.'},400)
  : !row ? c.json({error:'This request is unavailable, expired, or outside your family.'},404)
  : c.json({username:row.username,verificationCode:row.verification_code,expiresAt:row.expires_at*1000});
});
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the login approval HTTP endpoint using the native Hono request context and D1/response completion Promise.
auth.post('/challenges/:id/approve',requireAuth,async c=>{
 const allowed=await throttle(c,'approve',30);
 const row=allowed ? await approval(c).catch(always(undefined)) : null;
 const now=row ? Math.floor(Date.now()/1000) : 0;
 // The database trigger activates the pre-issued session exactly once on pending -> approved.
 // Await persistence before checking the session; a replay cannot reactivate a logged-out session.
 const session=row ? await (
  await c.env.DB.prepare("UPDATE login_challenges SET status='approved',approved_user_id=?,approved_by=?,approved_at=? WHERE id=? AND status='pending' AND expires_at>?").bind(row.target_id,c.get('identity').user.id,now,row.id,now).run(),
  c.env.DB.prepare('SELECT 1 AS active FROM sessions WHERE challenge_id=? AND expires_at>?').bind(row.id,now).first<Readonly<{active:number}>>()
 ) : null;
 return !allowed ? c.json({error:'Please slow down.'},429)
  : row===undefined ? c.json({error:'Invalid approval request.'},400)
  : !row ? c.json({error:'This request is unavailable, expired, or outside your family.'},404)
  : session ? c.json({status:'approved'}) : c.json({error:'This login request has expired.'},409);
});
