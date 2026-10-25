import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { always, zipObj } from 'ramda';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { EventInput } from '@little/shared/events';
import type { LoginChallenge, Identity, ScheduleRecord } from '@little/shared/api';

const origin='http://127.0.0.1:4321';
const script=(await build({entryPoints:['apps/api/src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'})).outputFiles[0].text;
type MigrationState = Readonly<{pending:string; statements:Readonly<Record<number,string>>; count:number}>;
function migrationLine(state:MigrationState,line:string):MigrationState {
 const pending=state.pending+line+'\n';
 const trigger=/^CREATE TRIGGER\b/i.test(pending.trimStart());
 const complete=trigger ? /^END;\s*$/.test(line) : /;\s*$/.test(line);
 return !line.trim()||line.trimStart().startsWith('--') ? state
  : complete ? {pending:'',statements:{...state.statements,[state.count]:pending},count:state.count+1}
  : {...state,pending};
}
// eslint-disable-next-line functional/prefer-immutable-types -- The native test context owns runtime cleanup, and fixture setup returns its environment completion Promise.
async function fixture(t:TestContext){
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the mutable Miniflare runtime handle for this test environment.
 const mf=new Miniflare(convertV4MiniflareOptions({name:'api',modules:true,script,compatibilityDate:'2026-10-21',compatibilityFlags:['nodejs_compat'],bindings:{FRONTEND_ORIGIN:origin,APP_BASE_URL:origin+'/'},d1Databases:{DB:randomUUID()}}));
 // eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/prefer-immutable-types -- Register runtime disposal with the test lifecycle; its callback returns the native cleanup Promise.
 t.after(()=>mf.dispose());
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native D1 database handle used by this isolated test environment.
 const db=await mf.getD1Database('DB');
 // eslint-disable-next-line functional/no-loop-statements -- Read and apply migration files in order against this isolated D1 environment.
 for(const file of ['0001_events.sql','0002_family_auth.sql']){
  const source=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');
  const migration=source.split('\n').reduce(migrationLine,{pending:'',statements:{},count:0});
  // eslint-disable-next-line functional/no-loop-statements -- Await each D1 schema write before applying dependent migration statements.
  for(const statement of Object.values(migration.statements)){
   // eslint-disable-next-line functional/no-expression-statements -- Apply migration statements sequentially to the isolated D1 test database.
   await db.prepare(statement).run();
  }
  assert.equal(migration.pending.trim(),'','migration statement was not terminated');
 }
 // eslint-disable-next-line functional/prefer-immutable-types -- Dispatch an HTTP request through Miniflare and return its native completion Promise.
 const request=(path:string,method='GET',body?:unknown,token?:string,from:string|undefined=origin)=>mf.dispatchFetch('https://api.example'+path,{method,headers:{...(from?{Origin:from}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 // eslint-disable-next-line functional/prefer-immutable-types -- Challenge setup completes the native HTTP request and JSON-body read through its Promise.
 async function challenge(name:string){
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response to check its status and consume its JSON body.
  const response=await request('/api/auth/challenges','POST',{username:name});
  return (assert.equal(response.status,201), await response.json() as LoginChallenge);
 }
 // eslint-disable-next-line functional/prefer-immutable-types -- The operator bootstrap writes to D1 and returns its native completion Promise.
 async function bootstrap(challenge:Readonly<LoginChallenge>,name:string,claimLegacy=0){
  const familyId=randomUUID(),userId=randomUUID();
  // eslint-disable-next-line functional/no-expression-statements -- Persist the operator approval in the isolated D1 test database so its bootstrap trigger can run.
  await db.prepare('INSERT INTO bootstrap_approvals (singleton,challenge_id,expected_username,family_id,user_id,family_name,claim_legacy) VALUES (1,?,?,?,?,?,?)').bind(challenge.id,name,familyId,userId,'Test family',claimLegacy).run();
  return {familyId,userId};
 }
 return {mf,db,request,challenge,bootstrap};
}

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('empty installation exposes no app data and has no public registration or bootstrap route',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const f=await fixture(t);
  // Previous browser bundles stay protected.
 // eslint-disable-next-line functional/no-loop-statements, functional/no-expression-statements -- Await each HTTP request and its assertion before sending the next request to the isolated API environment.
 for(const path of (assert.deepEqual([await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),(await f.request('/api/events')).status],[0,401]), ['/api/me','/api/schedules','/api/family']))assert.equal((await f.request(path)).status,401);

 // eslint-disable-next-line functional/no-loop-statements, functional/no-expression-statements -- Await each HTTP request and its assertion before sending the next request to the isolated API environment.
 for(const path of (assert.equal((await f.request('/api/family/members','POST',{username:'new-user'})).status,401), ['/api/auth/register','/api/auth/bootstrap','/api/register','/api/bootstrap']))assert.equal((await f.request(path,'POST',{username:'new-user'})).status,404);
 const c:Readonly<LoginChallenge>=await f.challenge('unknown-user');
 return assert.deepEqual([(await f.request('/api/me','GET',undefined,c.sessionToken)).status,(await f.request(`/api/auth/challenges/${c.id}/poll`,'POST',{pollToken:c.pollToken})).status,await f.db.prepare('SELECT count(*) AS n FROM users').first('n')],[401,200,0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('operator bootstrap atomically creates one family/user and activates only the applicant token',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const f=await fixture(t),c:Readonly<LoginChallenge>=await f.challenge('first-user');
 // eslint-disable-next-line functional/no-loop-statements, functional/no-expression-statements -- Await each HTTP request and its assertion before sending the next request to the isolated API environment.
 for(const token of [c.pollToken,c.approvalToken,c.sessionToken])assert.equal((await f.request('/api/me','GET',undefined,token)).status,401);
 const created:Readonly<{familyId:string;userId:string}>=(await assert.rejects(f.bootstrap(c,'wrong-user')), assert.deepEqual([await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),await f.db.prepare('SELECT count(*) AS n FROM families').first('n')],[0,0]), await f.bootstrap(c,'first-user'));
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const response=await f.request('/api/me','GET',undefined,c.sessionToken);
 const identity=(assert.equal(response.status,200), await response.json() as Readonly<{user:Readonly<Identity['user']>;family:Identity['family']}>);
 // eslint-disable-next-line functional/no-loop-statements, functional/no-expression-statements -- Await each HTTP request and its assertion before sending the next request to the isolated API environment.
 for(const token of (assert.deepEqual([identity.user.id,identity.family.id],[created.userId,created.familyId]), [c.pollToken,c.approvalToken]))assert.equal((await f.request('/api/me','GET',undefined,token)).status,401);


 // D1 stores only token hashes, never the three capabilities returned to the browser.
 const row=(await (assert.deepEqual([await (await f.request(`/api/auth/challenges/${c.id}/poll`,'POST',{pollToken:c.pollToken})).json(),await f.db.prepare('SELECT count(*) AS n FROM sessions').first('n')],[{status:'approved'},1]), assert.rejects(f.bootstrap(await f.challenge('second-user'),'second-user'))), assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),1), await f.db.prepare('SELECT poll_hash,approval_hash,session_hash FROM login_challenges WHERE id=?').bind(c.id).first<Readonly<Record<string,string>>>());
 return void ([{field:'poll_hash',token:c.pollToken},{field:'approval_hash',token:c.approvalToken},{field:'session_hash',token:c.sessionToken}] as const).every(entry => (assert.equal(row?.[entry.field],createHash('sha256').update(entry.token).digest('hex')), true));
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('unknown and registered usernames have the same challenge response and secrets are not interchangeable',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const f=await fixture(t),first:Readonly<LoginChallenge>=await f.challenge('registered-user');
 // eslint-disable-next-line functional/no-expression-statements -- Approve the first test user through the isolated D1 bootstrap operation.
 await f.bootstrap(first,'registered-user');
 const known:Readonly<LoginChallenge>=await f.challenge('registered-user'),unknown:Readonly<LoginChallenge>=await f.challenge('unknown-user');

 // eslint-disable-next-line functional/no-loop-statements -- Await each HTTP request and its assertion before sending the next request to the isolated API environment.
 for(const token of (assert.deepEqual([
  Object.keys(known).sort(),
  known.pollInterval,
  Math.abs(known.expiresAt-unknown.expiresAt)<=1000,
  new Set([known.pollToken,known.approvalToken,known.sessionToken]).size,
 ],[Object.keys(unknown).sort(),unknown.pollInterval,true,3]), [known.approvalToken,known.sessionToken])){
  // eslint-disable-next-line functional/no-expression-statements -- Send the HTTP request and verify its response before the next isolated API operation.
  assert.equal((await f.request(`/api/auth/challenges/${known.id}/poll`,'POST',{pollToken:token})).status,404);
 }
 return assert.deepEqual([(await f.request(`/api/auth/challenges/${known.id}/approve`,'POST',{approvalToken:known.pollToken},first.sessionToken)).status,(await f.request(`/api/auth/challenges/${known.id}/approve`,'POST',{approvalToken:known.approvalToken})).status,(await f.request(`/api/auth/challenges/${unknown.id}/inspect`,'POST',{approvalToken:unknown.approvalToken},first.sessionToken)).status,(await f.request('/api/me','GET',undefined,known.sessionToken)).status],[404,401,404,401]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('same-family approval works across users, is idempotent, and cannot reactivate a logged-out session',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const f=await fixture(t),first:Readonly<LoginChallenge>=await f.challenge('first-user');const owner:Readonly<{familyId:string;userId:string}>=await f.bootstrap(first,'first-user');
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const add=await f.request('/api/family/members','POST',{username:' Family_Member '},first.sessionToken);
 const added=(assert.equal(add.status,201), await add.json() as Readonly<{user:Readonly<Identity['user']>}>);
 const member:Readonly<LoginChallenge>=(assert.deepEqual([
  added.user.username,
  added.user.familyId,
  (await f.request('/api/family/members','POST',{username:'elsewhere',familyId:'forged-family'},first.sessionToken)).status,
 ],['family_member',owner.familyId,400]), await f.challenge('family_member'));

 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const inspected=(assert.equal((await f.request('/api/me','GET',undefined,member.sessionToken)).status,401), await f.request(`/api/auth/challenges/${member.id}/inspect`,'POST',{approvalToken:member.approvalToken},first.sessionToken));
 const inspection=(assert.equal(inspected.status,200), await inspected.json() as Readonly<{username:string;verificationCode:string}>);
 // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Each independent concurrent approval callback needs no input and returns its native HTTP completion Promise.
 const approvals:Readonly<Record<string,number>>=(assert.deepEqual([inspection.username,inspection.verificationCode],['family_member',member.verificationCode]), await Promise.all([1,2].map(async()=>(await f.request(`/api/auth/challenges/${member.id}/approve`,'POST',{approvalToken:member.approvalToken},first.sessionToken)).status)).then(zipObj(['first','second'])));
 // eslint-disable-next-line functional/no-loop-statements, functional/no-expression-statements -- Await each HTTP request and its assertion before sending the next request to the isolated API environment.
 for(const pollToken of (assert.deepEqual([approvals.first,approvals.second],[200,200]), [member.pollToken,member.pollToken]))assert.deepEqual(await (await f.request(`/api/auth/challenges/${member.id}/poll`,'POST',{pollToken})).json(),{status:'approved'});

 const memberCount=(assert.deepEqual([await f.db.prepare('SELECT count(*) AS n FROM sessions WHERE challenge_id=?').bind(member.id).first('n'),(await f.request('/api/me','GET',undefined,member.sessionToken)).status],[1,200]), ((await (await f.request('/api/family','GET',undefined,member.sessionToken)).json()) as Readonly<{members:ReadonlyArray<Identity['user']>}>).members.length);

 // Even cleanup removing the expired row must not make a replay activate it again.
 // eslint-disable-next-line functional/no-expression-statements -- Write test setup or expiry state to the isolated D1 database at this persistence boundary.
 await ((assert.deepEqual([
  memberCount,
  (await f.request('/api/auth/logout','POST',{},member.sessionToken)).status,
 ],[2,200]), assert.deepEqual([(await f.request('/api/me','GET',undefined,member.sessionToken)).status,(await f.request(`/api/auth/challenges/${member.id}/approve`,'POST',{approvalToken:member.approvalToken},first.sessionToken)).status],[401,409])), f.db.prepare('DELETE FROM sessions WHERE expires_at=0').run());
 return assert.deepEqual([(await f.request(`/api/auth/challenges/${member.id}/approve`,'POST',{approvalToken:member.approvalToken},first.sessionToken)).status,(await f.request('/api/me','GET',undefined,member.sessionToken)).status],[409,401]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('family members share existing and new schedules while only creators can change them',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const f=await fixture(t),first:Readonly<LoginChallenge>=await f.challenge('first-user');const owner:Readonly<{familyId:string;userId:string}>=await f.bootstrap(first,'first-user');
 // eslint-disable-next-line functional/no-expression-statements -- Create the test family member through the API before checking shared schedule access.
 await f.request('/api/family/members','POST',{username:'family-member'},first.sessionToken);
 const member:Readonly<LoginChallenge>=await f.challenge('family-member');
 // eslint-disable-next-line functional/no-expression-statements -- Approve the test member through the isolated HTTP API before checking shared schedules.
 await f.request(`/api/auth/challenges/${member.id}/approve`,'POST',{approvalToken:member.approvalToken},first.sessionToken);
 const outsider:Readonly<LoginChallenge>=await f.challenge('outsider-user'),familyId=randomUUID(),userId=randomUUID();
 // eslint-disable-next-line functional/no-expression-statements -- Write test setup or expiry state to the isolated D1 database at this persistence boundary.
 await f.db.batch([
  f.db.prepare('INSERT INTO families (id,name) VALUES (?,?)').bind(familyId,'Other family'),
  f.db.prepare('INSERT INTO users (id,username,family_id) VALUES (?,?,?)').bind(userId,'outsider-user',familyId),
  f.db.prepare("UPDATE login_challenges SET status='approved',approved_user_id=?,approved_at=unixepoch() WHERE id=?").bind(userId,outsider.id)
 ]);
 const attempt:Readonly<LoginChallenge>=await f.challenge('family-member');
 // eslint-disable-next-line functional/no-loop-statements, functional/no-expression-statements -- Await each HTTP request and its assertion before sending the next request to the isolated API environment.
 for(const action of ['inspect','approve'])assert.equal((await f.request(`/api/auth/challenges/${attempt.id}/${action}`,'POST',{approvalToken:attempt.approvalToken},outsider.sessionToken)).status,404);

 const event:Readonly<EventInput>=(assert.equal((await f.request('/api/me','GET',undefined,attempt.sessionToken)).status,401), {title:'Family event',emoji:'🌿',color:'#7ba989',startAt:'2026-10-01T00:00:00Z',targetAt:'2026-12-01T00:00:00Z',repeatUnit:'none',repeatEvery:1,timeZone:'Asia/Tokyo'});
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const created=await f.request('/api/schedules','POST',event,first.sessionToken);
 const saved=(assert.equal(created.status,201), await created.json() as Readonly<{event:Readonly<ScheduleRecord>}>);

 const shared=(assert.deepEqual([saved.event.createdBy.username,saved.event.canEdit],['first-user',true]), await (await f.request('/api/schedules','GET',undefined,member.sessionToken)).json() as Readonly<{events:ReadonlyArray<Readonly<ScheduleRecord>>}>);

 // eslint-disable-next-line functional/no-loop-statements -- Await each HTTP request and its assertion before sending the next request to the isolated API environment.
 for(const token of (assert.deepEqual([
  shared.events.length,
  shared.events[0].id,
  shared.events[0].createdBy,
  shared.events[0].canEdit,
  await (await f.request('/api/events','GET',undefined,member.sessionToken)).json(),
  await (await f.request('/api/schedules','GET',undefined,outsider.sessionToken)).json(),
  await (await f.request('/api/schedules?familyId='+owner.familyId,'GET',undefined,outsider.sessionToken)).json(),
 ],[1,saved.event.id,saved.event.createdBy,false,shared,{events:[]},{events:[]}]), [member.sessionToken,outsider.sessionToken])){
  // eslint-disable-next-line functional/no-expression-statements -- Send the HTTP request and verify its response before the next isolated API operation.
  assert.deepEqual([(await f.request('/api/schedules/'+saved.event.id,'PUT',{...event,title:'Stolen',canEdit:true},token)).status,(await f.request('/api/schedules/'+saved.event.id,'DELETE',undefined,token)).status],[404,404]);
 }

 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const updated=(assert.equal((await f.request('/api/schedules/'+saved.event.id,'PUT',{...event,color:'red'},first.sessionToken)).status,400), await f.request('/api/schedules/'+saved.event.id,'PUT',{...event,title:'Updated'},first.sessionToken));

 const owned=(assert.deepEqual([updated.status,((await updated.json()) as {event:ScheduleRecord}).event.canEdit],[200,true]), ((await (await f.request('/api/schedules','GET',undefined,first.sessionToken)).json()) as Readonly<{events:ReadonlyArray<ScheduleRecord>}>).events[0]);

 const refreshedTitle=(assert.deepEqual([owned.title,owned.canEdit],['Updated',true]), ((await (await f.request('/api/schedules','GET',undefined,member.sessionToken)).json()) as Readonly<{events:ReadonlyArray<ScheduleRecord>}>).events[0].title);
 // Member-created events are shared in the opposite direction, too.
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const memberCreated=(assert.equal(refreshedTitle,'Updated'), await f.request('/api/schedules','POST',{...event,title:'Member event'},member.sessionToken));
 const memberEvent=(assert.equal(memberCreated.status,201), ((await memberCreated.json()) as {event:Readonly<ScheduleRecord>}).event);

 const combined=(assert.deepEqual([memberEvent.canEdit,memberEvent.createdBy.username],[true,'family-member']), await (await f.request('/api/schedules','GET',undefined,first.sessionToken)).json() as Readonly<{events:ReadonlyArray<Readonly<ScheduleRecord>>}>);
 return assert.deepEqual([
  combined.events.length,
  combined.events.find((e:Readonly<ScheduleRecord>)=>e.id===memberEvent.id)?.canEdit,
  (await f.request('/api/schedules/'+memberEvent.id,'DELETE',undefined,first.sessionToken)).status,
  (await f.request('/api/schedules/'+saved.event.id,'DELETE',undefined,first.sessionToken)).status,
  (await f.request('/api/schedules/'+memberEvent.id,'DELETE',undefined,member.sessionToken)).status,
  await (await f.request('/api/schedules','GET',undefined,member.sessionToken)).json(),
 ],[2,false,404,200,200,{events:[]}]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('family schedule reads include existing events beyond the former 500-event read limit',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const f=await fixture(t),first:Readonly<LoginChallenge>=await f.challenge('first-user');const owner:Readonly<{familyId:string;userId:string}>=await f.bootstrap(first,'first-user');
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const added=await f.request('/api/family/members','POST',{username:'family-member'},first.sessionToken);
 const member=((await added.json()) as {user:Readonly<Identity['user']>}).user;
 // eslint-disable-next-line functional/no-expression-statements -- Write test setup or expiry state to the isolated D1 database at this persistence boundary.
 await f.db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<501)
  INSERT INTO events (id,owner_id,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at)
  SELECT 'existing-'||n, CASE WHEN n<=500 THEN ? ELSE ? END, 'Existing '||n, '🌿', '#7ba989',
   '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'none', 1, 'UTC', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  FROM numbers`).bind(owner.userId,member.id).run();
 const result=await (await f.request('/api/schedules','GET',undefined,first.sessionToken)).json() as Readonly<{events:ReadonlyArray<Readonly<ScheduleRecord>>}>;
 return assert.deepEqual([
  result.events.length,
  result.events.filter((e:Readonly<ScheduleRecord>)=>e.canEdit).length,
  result.events.find((e:Readonly<ScheduleRecord>)=>e.createdBy.id===member.id)?.canEdit,
  (await f.request('/api/schedules','POST',result.events[0],first.sessionToken)).status,
 ],[501,500,false,409]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('expired challenges and sessions cannot be approved or authenticated, and concurrent bootstrap has one winner',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const f=await fixture(t),expired:Readonly<LoginChallenge>=await f.challenge('expired-user');
 // eslint-disable-next-line functional/no-expression-statements -- Write test setup or expiry state to the isolated D1 database at this persistence boundary.
 await f.db.prepare('UPDATE login_challenges SET expires_at=unixepoch()-1 WHERE id=?').bind(expired.id).run();
 const a:Readonly<LoginChallenge>=(assert.deepEqual(await (await f.request(`/api/auth/challenges/${expired.id}/poll`,'POST',{pollToken:expired.pollToken})).json(),{status:'expired'}), await assert.rejects(f.bootstrap(expired,'expired-user')), assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),0), await f.challenge('candidate-alpha')),b:Readonly<LoginChallenge>=await f.challenge('candidate-bravo');
 const statuses:Readonly<Record<string,'fulfilled'|'rejected'>>=await Promise.all([
  f.bootstrap(a,'candidate-alpha').then(always('fulfilled' as const),always('rejected' as const)),
  f.bootstrap(b,'candidate-bravo').then(always('fulfilled' as const),always('rejected' as const)),
 ]).then(zipObj(['first','second']));

 const winner=(assert.deepEqual([[statuses.first,statuses.second].filter(status=>status==='fulfilled').length,await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),await f.db.prepare('SELECT count(*) AS n FROM families').first('n')],[1,1,1]), statuses.first==='fulfilled'?a:b);

 const knownExpired:Readonly<LoginChallenge>=(assert.deepEqual([await f.db.prepare('SELECT count(*) AS n FROM sessions').first('n'),(await f.request('/api/me','GET',undefined,winner.sessionToken)).status],[1,200]), await f.challenge(statuses.first==='fulfilled'?'candidate-alpha':'candidate-bravo'));
 // eslint-disable-next-line functional/no-expression-statements -- Write test setup or expiry state to the isolated D1 database at this persistence boundary.
 await f.db.prepare('UPDATE login_challenges SET expires_at=unixepoch()-1 WHERE id=?').bind(knownExpired.id).run();
 // eslint-disable-next-line functional/no-loop-statements, functional/no-expression-statements -- Await each expiry-protected HTTP operation before sending the next isolated API request.
 for(const action of ['inspect','approve'])assert.equal((await f.request(`/api/auth/challenges/${knownExpired.id}/${action}`,'POST',{approvalToken:knownExpired.approvalToken},winner.sessionToken)).status,404);
 // eslint-disable-next-line functional/no-expression-statements -- Complete this HTTP request and response assertion before the next isolated API operation.
 assert.equal((await f.request('/api/me','GET',undefined,knownExpired.sessionToken)).status,401);
 // eslint-disable-next-line functional/no-expression-statements -- Write test setup or expiry state to the isolated D1 database at this persistence boundary.
 await f.db.prepare('UPDATE sessions SET expires_at=unixepoch()-1').run();
 return assert.equal((await f.request('/api/me','GET',undefined,winner.sessionToken)).status,401);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('origin checks, request bounds, malformed input and login rate limits are enforced',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const f=await fixture(t);
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const foreign=await f.request('/api/auth/challenges','POST',{username:'first-user'},undefined,'https://evil.example');
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native HTTP response for status, header, or JSON-body assertions at this request boundary.
 const preflight=(assert.deepEqual([
  foreign.status,
  foreign.headers.get('Access-Control-Allow-Origin'),
  (await f.request('/api/auth/challenges','POST',{username:'first-user'})).status,
  (await f.mf.dispatchFetch('https://api.example/api/auth/challenges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'first-user'})})).status,
 // eslint-disable-next-line functional/no-expression-statements -- Complete this HTTP request and response assertion before the next isolated API operation.
 ],[403,null,201,403]), await f.request('/api/auth/challenges','OPTIONS'));assert.deepEqual([
  preflight.status,
  preflight.headers.get('Access-Control-Allow-Origin'),
  preflight.headers.get('Access-Control-Allow-Origin')!=='*',
  (await f.request('/api/auth/challenges','POST',{username:'email@example.com'})).status,
  (await f.request('/api/auth/challenges','POST',{username:'a'.repeat(9000)})).status,
  (await f.request('/api/auth/challenges','POST',[])).status,
 ],[204,origin,true,400,413,400]);
 // eslint-disable-next-line functional/no-loop-statements, functional/no-expression-statements -- Await each rate-limit request before issuing the next request against the isolated API.
 for(const i of [0,1,2,3,4])await f.request('/api/auth/challenges','POST',{username:'rate-test-'+i});
 return assert.deepEqual([
  (await f.request('/api/auth/challenges','POST',{username:'rate-over-limit'})).status,
  await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),
 ],[429,0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register and await this integration test in the runner lifecycle, which supplies its mutable context and native completion Promise.
await test('legacy events are preserved and require an explicit operator ownership claim',async(t)=>{
 // eslint-disable-next-line functional/prefer-immutable-types -- Legacy setup receives the native test environment handles and returns its D1 completion Promise.
 const insertLegacy=async(f:Awaited<ReturnType<typeof fixture>>)=>{
  // eslint-disable-next-line functional/no-expression-statements -- Insert legacy rows directly into the isolated D1 database to exercise operator ownership claims.
  await f.db.prepare("INSERT INTO legacy_events (id,owner,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(randomUUID(),'legacy@example.test','Preserved legacy event','🌿','#7ba989','2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','none',1,'UTC','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z').run();};
 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const unclaimed=await fixture(t);
 // eslint-disable-next-line functional/no-expression-statements -- Seed the isolated legacy database before exercising the operator ownership claim.
 await insertLegacy(unclaimed);const c:Readonly<LoginChallenge>=await unclaimed.challenge('first-user');
 // eslint-disable-next-line functional/no-expression-statements -- Apply the operator approval to this isolated test database.
 await unclaimed.bootstrap(c,'first-user',0);

 // eslint-disable-next-line functional/prefer-immutable-types -- Retain this isolated test environment’s native Miniflare, D1, and HTTP operation handles.
 const claimed=(assert.deepEqual([
  await (await unclaimed.request('/api/events','GET',undefined,c.sessionToken)).json(),
  await (await unclaimed.request('/api/schedules','GET',undefined,c.sessionToken)).json(),
  await unclaimed.db.prepare('SELECT count(*) AS n FROM legacy_events').first('n'),
 ],[{events:[]},{events:[]},1]), await fixture(t));
 // eslint-disable-next-line functional/no-expression-statements -- Seed the isolated legacy database before exercising the operator ownership claim.
 await insertLegacy(claimed);const d:Readonly<LoginChallenge>=await claimed.challenge('first-user');
 // eslint-disable-next-line functional/no-expression-statements -- Apply the operator approval to this isolated test database.
 await claimed.bootstrap(d,'first-user',1);
 const legacyTitle=((await (await claimed.request('/api/schedules','GET',undefined,d.sessionToken)).json()) as Readonly<{events:ReadonlyArray<Readonly<{title:string}>>}>).events[0].title;return assert.deepEqual([legacyTitle,await claimed.db.prepare('SELECT count(*) AS n FROM legacy_events').first('n')],['Preserved legacy event',1]);
});
