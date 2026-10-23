import type { Identity } from '@little/shared/api';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { auth } from './auth';
import { events } from './events';
import { jsonObject,requireAuth,throttle,username } from './security';
import type { AppEnv,ApiBindings } from './types';
function memberUsername(data:Readonly<Record<string,unknown>>):string {
 if(Object.keys(data).some(k=>k!=='username'))throw new Error('Only a username is accepted.');
 return username(data.username);
}
const app=new Hono<AppEnv>();
// eslint-disable-next-line functional/no-expression-statements -- Register the HTTP origin and response-header middleware with the Hono router.
app.use('*',async(c,next)=>{
 const origin=c.req.header('Origin');
 // eslint-disable-next-line functional/no-expression-statements -- Write the HTTP response cache policy at the Hono response boundary.
 c.header('Cache-Control','no-store');
 // eslint-disable-next-line functional/no-expression-statements -- Write the HTTP content-sniffing protection at the Hono response boundary.
 c.header('X-Content-Type-Options','nosniff');
 // eslint-disable-next-line functional/no-expression-statements -- Write the HTTP referrer policy at the Hono response boundary.
 c.header('Referrer-Policy','no-referrer');
 // eslint-disable-next-line functional/no-expression-statements -- Write the HTTP cache variation header for the request origin.
 c.header('Vary','Origin');
 if(origin&&origin!==c.env.FRONTEND_ORIGIN)return c.json({error:'Request origin not allowed.'},403);
 if(origin){
  // eslint-disable-next-line functional/no-expression-statements -- Write the allowed origin to the HTTP response at the CORS boundary.
  c.header('Access-Control-Allow-Origin',origin);
  // eslint-disable-next-line functional/no-expression-statements -- Write the allowed request headers to the HTTP response at the CORS boundary.
  c.header('Access-Control-Allow-Headers','Content-Type, Authorization');
  // eslint-disable-next-line functional/no-expression-statements -- Write the allowed methods to the HTTP response at the CORS boundary.
  c.header('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');
  // eslint-disable-next-line functional/no-expression-statements -- Write the preflight cache lifetime to the HTTP response at the CORS boundary.
  c.header('Access-Control-Max-Age','600');
 }
 if(c.req.method==='OPTIONS')return c.body(null,204);
 if(!['GET','HEAD'].includes(c.req.method)&&origin!==c.env.FRONTEND_ORIGIN)return c.json({error:'Request origin required.'},403);
 // eslint-disable-next-line functional/no-expression-statements -- Dispatch the request to downstream Hono middleware after writing response headers.
 await next();
});
// eslint-disable-next-line functional/no-expression-statements -- Register the HTTP request body limit middleware with the Hono router.
app.use('/api/*',bodyLimit({maxSize:8192,onError:c=>c.json({error:'Request is too large.'},413)}));
// eslint-disable-next-line functional/no-expression-statements -- Register the health check HTTP endpoint with the Hono router.
app.get('/health',c=>c.json({ok:true}));
// eslint-disable-next-line functional/no-expression-statements -- Mount authentication HTTP endpoints on the Hono router.
app.route('/api/auth',auth);
// eslint-disable-next-line functional/no-expression-statements -- Register the current identity HTTP endpoint with the Hono router.
app.get('/api/me',requireAuth,c=>c.json(c.get('identity')));
// eslint-disable-next-line functional/no-expression-statements -- Register the family listing HTTP endpoint with the Hono router.
app.get('/api/family',requireAuth,async c=>{
 const family=c.get('identity').family;
 const r=await c.env.DB.prepare('SELECT id,username,family_id AS familyId FROM users WHERE family_id=? ORDER BY created_at,id LIMIT 50').bind(family.id).all();return c.json({family,members:r.results});
});
// eslint-disable-next-line functional/no-expression-statements -- Register the family member creation HTTP endpoint with the Hono router.
app.post('/api/family/members',requireAuth,async c=>{
 const identity:Readonly<{user:Readonly<Identity['user']>;family:Identity['family']}>=c.get('identity');
 const allowed=await throttle(c,'member-add',10,3600,identity.user.id);
 const name=allowed ? await jsonObject(c).then(memberUsername)
  .catch((e:unknown):Readonly<{error:string}>=>({error:e instanceof Error?e.message:'Invalid username.'}))
  : {error:'Please try again later.'} as const;
 if(!allowed||typeof name!=='string')return c.json(name,allowed?400:429);
 const id=crypto.randomUUID();
 try{
  const {meta:{changes}}:Readonly<{meta:Readonly<{changes:number}>}>=await c.env.DB.prepare('INSERT INTO users (id,username,family_id) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM users WHERE family_id=?)<50').bind(id,name,identity.family.id,identity.family.id).run();
  if(!changes)return c.json({error:'This family has reached its limit of 50 members.'},409);
 }catch(e){if(e instanceof Error&&e.message.includes('UNIQUE'))return c.json({error:'That username is not available.'},409);throw e;}
 return c.json({user:{id,username:name,familyId:identity.family.id}},201);
});
// Use a schedule-specific path; /api/events on workers.dev matches EasyPrivacy.
// eslint-disable-next-line functional/no-expression-statements -- Mount schedule HTTP endpoints on the Hono router.
app.route('/api/schedules',events);
// Retain the old route while existing browser bundles refresh.
// eslint-disable-next-line functional/no-expression-statements -- Mount the legacy schedule HTTP alias on the Hono router.
app.route('/api/events',events);
// eslint-disable-next-line functional/no-expression-statements -- Register the unmatched-request HTTP response handler with the Hono router.
app.notFound(c=>c.json({error:'Not found.'},404));
// eslint-disable-next-line functional/no-expression-statements -- Register the HTTP error response handler with the Hono router.
app.onError((error,c)=>{
 // eslint-disable-next-line functional/no-expression-statements -- Report request failures through the Worker logging boundary without sensitive request data.
 console.error(JSON.stringify({event:'request_failed',type:error.name}));
 return c.json({error:'Something went wrong. Please try again.'},500);
});
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
