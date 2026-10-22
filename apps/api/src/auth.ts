import { Hono } from 'hono';
import { CHALLENGE_SECONDS,hash,jsonObject,randomToken,requireAuth,throttle,username,validId,validToken } from './security';
import type { AppEnv } from './types';
interface Challenge { readonly id:string; readonly username:string; readonly poll_hash:string; readonly approval_hash:string; readonly session_hash:string; readonly verification_code:string; readonly status:'pending'|'approved'; readonly expires_at:number; readonly target_id:string; readonly family_id:string; }
export const auth=new Hono<AppEnv>();
auth.post('/challenges',async c=>{
 if(!await throttle(c,'start',8))return c.json({error:'Too many login attempts. Please wait a minute.'},429);
 let name:string;try{name=username((await jsonObject(c)).username);}catch(e){return c.json({error:e instanceof Error?e.message:'Invalid username.'},400);}
 if(!await throttle(c,'username-start',8,60,name))return c.json({error:'Too many login attempts. Please wait a minute.'},429);
 const id=crypto.randomUUID(),pollToken=randomToken(),approvalToken=randomToken(),sessionToken=randomToken(),verificationCode=randomToken(5).slice(0,6).toUpperCase();
 const now=Math.floor(Date.now()/1000),expiresAt=now+CHALLENGE_SECONDS;
 // Do not look up the username here: registered and unknown names have the same response.
 const r=await c.env.DB.prepare('INSERT INTO login_challenges (id,username,poll_hash,approval_hash,session_hash,verification_code,created_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM login_challenges WHERE expires_at>?)<1000').bind(id,name,await hash(pollToken),await hash(approvalToken),await hash(sessionToken),verificationCode,now,expiresAt,now).run();
 if(!r.meta.changes)return c.json({error:'Please try again later.'},429);
 return c.json({id,pollToken,sessionToken,approvalToken,expiresAt:expiresAt*1000,pollInterval:3000,verificationCode},201);
});
auth.post('/challenges/:id/poll',async c=>{
 if(!await throttle(c,'poll',240))return c.json({error:'Please slow down.'},429);
 const id=c.req.param('id');let input:Record<string,unknown>;try{input=await jsonObject(c);}catch{return c.json({error:'Invalid login request.'},400);}
 if(!validId(id)||!validToken(input.pollToken))return c.json({error:'Invalid login request.'},400);
 const row=await c.env.DB.prepare('SELECT status,expires_at FROM login_challenges WHERE id=? AND poll_hash=?').bind(id,await hash(input.pollToken)).first<Readonly<{status:string;expires_at:number}>>();
 if(!row)return c.json({error:'Login request not found.'},404);
 if(row.expires_at<=Math.floor(Date.now()/1000))return c.json({status:'expired'});
 return c.json({status:row.status});
});
auth.post('/logout',requireAuth,async c=>{await c.env.DB.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(c.get('sessionHash')).run();return c.json({ok:true});});
async function approval(c: Parameters<typeof jsonObject>[0]) {
 const id=c.req.param('id');const input=await jsonObject(c);
 if(!validId(id)||!validToken(input.approvalToken))return null;
 return c.env.DB.prepare('SELECT l.*,u.id AS target_id,u.family_id FROM login_challenges l JOIN users u ON u.username=l.username COLLATE NOCASE WHERE l.id=? AND l.approval_hash=? AND u.family_id=? AND l.expires_at>unixepoch()').bind(id,await hash(input.approvalToken),c.get('identity').family.id).first<Challenge>();
}
auth.post('/challenges/:id/inspect',requireAuth,async c=>{
 if(!await throttle(c,'inspect',60))return c.json({error:'Please slow down.'},429);
 let row:Challenge|null;try{row=await approval(c);}catch{return c.json({error:'Invalid approval request.'},400);}
 if(!row)return c.json({error:'This request is unavailable, expired, or outside your family.'},404);
 return c.json({username:row.username,verificationCode:row.verification_code,expiresAt:row.expires_at*1000});
});
auth.post('/challenges/:id/approve',requireAuth,async c=>{
 if(!await throttle(c,'approve',30))return c.json({error:'Please slow down.'},429);
 let row:Challenge|null;try{row=await approval(c);}catch{return c.json({error:'Invalid approval request.'},400);}
 if(!row)return c.json({error:'This request is unavailable, expired, or outside your family.'},404);
 const now=Math.floor(Date.now()/1000);
 // The database trigger activates the pre-issued session exactly once on pending -> approved.
 await c.env.DB.prepare("UPDATE login_challenges SET status='approved',approved_user_id=?,approved_by=?,approved_at=? WHERE id=? AND status='pending' AND expires_at>?").bind(row.target_id,c.get('identity').user.id,now,row.id,now).run();
 // A repeated approval cannot reactivate a logged-out session.
 const session=await c.env.DB.prepare('SELECT 1 AS active FROM sessions WHERE challenge_id=? AND expires_at>?').bind(row.id,now).first<Readonly<{active:number}>>();
 return session?c.json({status:'approved'}):c.json({error:'This login request has expired.'},409);
});
