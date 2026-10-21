import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { auth } from './auth';
import { events } from './events';
import { jsonObject,requireAuth,throttle,username } from './security';
import type { AppEnv,ApiBindings } from './types';
const app=new Hono<AppEnv>();
app.use('*',async(c,next)=>{
 const origin=c.req.header('Origin');
 c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');
 c.header('Vary','Origin');
 if(origin&&origin!==c.env.FRONTEND_ORIGIN)return c.json({error:'Request origin not allowed.'},403);
 if(origin){c.header('Access-Control-Allow-Origin',origin);c.header('Access-Control-Allow-Headers','Content-Type, Authorization');c.header('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');c.header('Access-Control-Max-Age','600');}
 if(c.req.method==='OPTIONS')return c.body(null,204);
 if(!['GET','HEAD'].includes(c.req.method)&&origin!==c.env.FRONTEND_ORIGIN)return c.json({error:'Request origin required.'},403);
 await next();
});
app.use('/api/*',bodyLimit({maxSize:8192,onError:c=>c.json({error:'Request is too large.'},413)}));
app.get('/health',c=>c.json({ok:true}));
app.route('/api/auth',auth);
app.get('/api/me',requireAuth,c=>c.json(c.get('identity')));
app.get('/api/family',requireAuth,async c=>{
 const family=c.get('identity').family;
 const r=await c.env.DB.prepare('SELECT id,username,family_id AS familyId FROM users WHERE family_id=? ORDER BY created_at,id LIMIT 50').bind(family.id).all();return c.json({family,members:r.results});
});
app.post('/api/family/members',requireAuth,async c=>{
 const identity=c.get('identity');if(!await throttle(c,'member-add',10,3600,identity.user.id))return c.json({error:'Please try again later.'},429);
 let name:string;try{const data=await jsonObject(c);if(Object.keys(data).some(k=>k!=='username'))throw new Error('Only a username is accepted.');name=username(data.username);}catch(e){return c.json({error:e instanceof Error?e.message:'Invalid username.'},400);}
 const id=crypto.randomUUID();
 try{
  const r=await c.env.DB.prepare('INSERT INTO users (id,username,family_id) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM users WHERE family_id=?)<50').bind(id,name,identity.family.id,identity.family.id).run();
  if(!r.meta.changes)return c.json({error:'This family has reached its limit of 50 members.'},409);
 }catch(e){if(e instanceof Error&&e.message.includes('UNIQUE'))return c.json({error:'That username is not available.'},409);throw e;}
 return c.json({user:{id,username:name,familyId:identity.family.id}},201);
});
app.route('/api/events',events);
app.notFound(c=>c.json({error:'Not found.'},404));
app.onError((error,c)=>{console.error(JSON.stringify({event:'request_failed',type:error.name}));return c.json({error:'Something went wrong. Please try again.'},500);});
export {app};
export default {
 fetch:app.fetch,
 async scheduled(_event:ScheduledController,env:ApiBindings){
  // Remove old capabilities without retaining usernames, tokens, or IP addresses in logs.
  await env.DB.batch([
   env.DB.prepare('DELETE FROM sessions WHERE expires_at<unixepoch()'),
   env.DB.prepare('DELETE FROM login_challenges WHERE expires_at<unixepoch()-86400 AND id NOT IN (SELECT challenge_id FROM sessions) AND id NOT IN (SELECT challenge_id FROM bootstrap_approvals)'),
   env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<unixepoch()')
  ]);
 }
} satisfies ExportedHandler<ApiBindings>;
