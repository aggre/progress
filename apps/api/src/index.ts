import type { Identity } from '@little/shared/api';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { auth } from './auth';
import { events } from './events';
import { jsonObject,memberUsername,requireAuth,throttle } from './security';
import type { AppEnv,ApiBindings } from './types';
// eslint-disable-next-line functional/no-throw-statements -- Propagate unexpected D1 failures to Hono’s request error boundary without changing the original rejection.
function rethrow(error:unknown):never { throw error; }
// eslint-disable-next-line functional/prefer-immutable-types -- Retain the native Hono router instance to register HTTP middleware and routes.
const app=new Hono<AppEnv>();
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the HTTP origin middleware, which updates the native Hono context and returns its dispatch completion Promise.
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
 return origin&&origin!==c.env.FRONTEND_ORIGIN
  ? c.json({error:'Request origin not allowed.'},403)
  : (
   origin&&(
    c.header('Access-Control-Allow-Origin',origin),
    c.header('Access-Control-Allow-Headers','Content-Type, Authorization'),
    c.header('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS'),
    c.header('Access-Control-Max-Age','600')
   ),
   c.req.method==='OPTIONS' ? c.body(null,204)
    : !['GET','HEAD'].includes(c.req.method)&&origin!==c.env.FRONTEND_ORIGIN
     ? c.json({error:'Request origin required.'},403)
     : await next()
  );
});
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the request-size middleware whose rejection callback reads the native Hono context and returns an HTTP Response.
app.use('/api/*',bodyLimit({maxSize:8192,onError:c=>c.json({error:'Request is too large.'},413)}));
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the health endpoint which reads the native Hono context and returns an HTTP Response.
app.get('/health',c=>c.json({ok:true}));
// eslint-disable-next-line functional/no-expression-statements -- Mount authentication HTTP endpoints on the Hono router.
app.route('/api/auth',auth);
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the identity endpoint which reads the native Hono context and returns an HTTP Response.
app.get('/api/me',requireAuth,c=>c.json(c.get('identity')));
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the family listing endpoint using the native Hono context and D1/response completion Promise.
app.get('/api/family',requireAuth,async c=>{
 const family=c.get('identity').family;
 return c.json({family,members:(await c.env.DB.prepare('SELECT id,username,family_id AS familyId FROM users WHERE family_id=? ORDER BY created_at,id LIMIT 50').bind(family.id).all()).results});
});
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the family member creation endpoint using the native Hono context and D1/response completion Promise.
app.post('/api/family/members',requireAuth,async c=>{
 const identity:Readonly<{user:Readonly<Identity['user']>;family:Identity['family']}>=c.get('identity');
 const allowed=await throttle(c,'member-add',10,3600,identity.user.id);
 const name=allowed ? await jsonObject(c).then(memberUsername)
  .catch((e:unknown):Readonly<{error:string}>=>({error:e instanceof Error?e.message:'Invalid username.'}))
  : {error:'Please try again later.'} as const;
 if(!allowed||typeof name!=='string')return c.json(name,allowed?400:429);
 const id=crypto.randomUUID();
 // eslint-disable-next-line functional/no-try-statements -- Translate D1 username conflicts at the family member persistence boundary.
 try{
  const {meta:{changes}}:Readonly<{meta:Readonly<{changes:number}>}>=await c.env.DB.prepare('INSERT INTO users (id,username,family_id) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM users WHERE family_id=?)<50').bind(id,name,identity.family.id,identity.family.id).run();
  if(!changes)return c.json({error:'This family has reached its limit of 50 members.'},409);
 }catch(e){return e instanceof Error&&e.message.includes('UNIQUE') ? c.json({error:'That username is not available.'},409) : rethrow(e);}
 return c.json({user:{id,username:name,familyId:identity.family.id}},201);
});
// Use a schedule-specific path; /api/events on workers.dev matches EasyPrivacy.
// eslint-disable-next-line functional/no-expression-statements -- Mount schedule HTTP endpoints on the Hono router.
app.route('/api/schedules',events);
// Retain the old route while existing browser bundles refresh.
// eslint-disable-next-line functional/no-expression-statements -- Mount the legacy schedule HTTP alias on the Hono router.
app.route('/api/events',events);
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the unmatched-request handler using the native Hono context and HTTP Response.
app.notFound(c=>c.json({error:'Not found.'},404));
// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the error response handler using the native Hono context and HTTP Response.
app.onError((error:Readonly<{name:string}>,c)=>{
 // eslint-disable-next-line functional/no-expression-statements -- Report request failures through the Worker logging boundary without sensitive request data.
 console.error(JSON.stringify({event:'request_failed',type:error.name}));
 return c.json({error:'Something went wrong. Please try again.'},500);
});
export {app};
export default {
 fetch:app.fetch,
 // eslint-disable-next-line functional/prefer-immutable-types -- The Worker scheduler supplies its native controller and D1 environment; cleanup returns a completion Promise.
 async scheduled(_event:ScheduledController,env:ApiBindings){
  // Remove old capabilities without retaining usernames, tokens, or IP addresses in logs.
  // eslint-disable-next-line functional/no-expression-statements -- Delete expired authentication capabilities and rate limits at the scheduled D1 persistence boundary.
  await env.DB.batch([
   env.DB.prepare('DELETE FROM sessions WHERE expires_at<unixepoch()'),
   env.DB.prepare('DELETE FROM login_challenges WHERE expires_at<unixepoch()-86400 AND id NOT IN (SELECT challenge_id FROM sessions) AND id NOT IN (SELECT challenge_id FROM bootstrap_approvals)'),
   env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<unixepoch()')
  ]);
 }
} satisfies ExportedHandler<ApiBindings>;
