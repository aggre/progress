import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { EventInput } from '@little/shared/events';
import type { LoginChallenge, Identity, ScheduleRecord } from '@little/shared/api';

const origin='http://127.0.0.1:4321';
const script=(await build({entryPoints:['apps/api/src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'})).outputFiles[0].text;
async function fixture(t:TestContext){
 const mf=new Miniflare(convertV4MiniflareOptions({name:'api',modules:true,script,compatibilityDate:'2026-10-21',compatibilityFlags:['nodejs_compat'],bindings:{FRONTEND_ORIGIN:origin,APP_BASE_URL:origin+'/'},d1Databases:{DB:randomUUID()}}));t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 for(const file of ['0001_events.sql','0002_family_auth.sql']){
  const source=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');
  let statement='';
  for(const line of source.split('\n')){
   if(!line.trim()||line.trimStart().startsWith('--'))continue;
   statement+=line+'\n';
   const trigger=/^CREATE TRIGGER\b/i.test(statement.trimStart());
   if(trigger ? /^END;\s*$/.test(line) : /;\s*$/.test(line)){await db.prepare(statement).run();statement='';}
  }
  assert.equal(statement.trim(),'','migration statement was not terminated');
 }
 const request=(path:string,method='GET',body?:unknown,token?:string,from:string|undefined=origin)=>mf.dispatchFetch('https://api.example'+path,{method,headers:{...(from?{Origin:from}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 async function challenge(name:string){const response=await request('/api/auth/challenges','POST',{username:name});assert.equal(response.status,201);return await response.json() as LoginChallenge;}
 async function bootstrap(challenge:Readonly<LoginChallenge>,name:string,claimLegacy=0){const familyId=randomUUID(),userId=randomUUID();await db.prepare('INSERT INTO bootstrap_approvals (singleton,challenge_id,expected_username,family_id,user_id,family_name,claim_legacy) VALUES (1,?,?,?,?,?,?)').bind(challenge.id,name,familyId,userId,'Test family',claimLegacy).run();return {familyId,userId};}
 return {mf,db,request,challenge,bootstrap};
}

await test('empty installation exposes no app data and has no public registration or bootstrap route',async(t)=>{
 const f=await fixture(t);
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),0);
 assert.equal((await f.request('/api/events')).status,401); // Previous browser bundles stay protected.
 for(const path of ['/api/me','/api/schedules','/api/family'])assert.equal((await f.request(path)).status,401);
 assert.equal((await f.request('/api/family/members','POST',{username:'new-user'})).status,401);
 for(const path of ['/api/auth/register','/api/auth/bootstrap','/api/register','/api/bootstrap'])assert.equal((await f.request(path,'POST',{username:'new-user'})).status,404);
 const c:Readonly<LoginChallenge>=await f.challenge('unknown-user');
 assert.equal((await f.request('/api/me','GET',undefined,c.sessionToken)).status,401);
 assert.equal((await f.request(`/api/auth/challenges/${c.id}/poll`,'POST',{pollToken:c.pollToken})).status,200);
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),0);
});

await test('operator bootstrap atomically creates one family/user and activates only the applicant token',async(t)=>{
 const f=await fixture(t),c:Readonly<LoginChallenge>=await f.challenge('first-user');
 for(const token of [c.pollToken,c.approvalToken,c.sessionToken])assert.equal((await f.request('/api/me','GET',undefined,token)).status,401);
 await assert.rejects(f.bootstrap(c,'wrong-user'));
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),0);
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM families').first('n'),0);
 const created:Readonly<{familyId:string;userId:string}>=await f.bootstrap(c,'first-user');
 const response=await f.request('/api/me','GET',undefined,c.sessionToken);assert.equal(response.status,200);
 const identity=await response.json() as Readonly<{user:Readonly<Identity['user']>;family:Identity['family']}>;assert.deepEqual([identity.user.id,identity.family.id],[created.userId,created.familyId]);
 for(const token of [c.pollToken,c.approvalToken])assert.equal((await f.request('/api/me','GET',undefined,token)).status,401);
 assert.deepEqual(await (await f.request(`/api/auth/challenges/${c.id}/poll`,'POST',{pollToken:c.pollToken})).json(),{status:'approved'});
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM sessions').first('n'),1);
 await assert.rejects(f.bootstrap(await f.challenge('second-user'),'second-user'));
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),1);
 // D1 stores only token hashes, never the three capabilities returned to the browser.
 const row=await f.db.prepare('SELECT poll_hash,approval_hash,session_hash FROM login_challenges WHERE id=?').bind(c.id).first<Record<string,string>>();
 for(const [field,token] of [['poll_hash',c.pollToken],['approval_hash',c.approvalToken],['session_hash',c.sessionToken]])assert.equal(row?.[field],createHash('sha256').update(token).digest('hex'));
});

await test('unknown and registered usernames have the same challenge response and secrets are not interchangeable',async(t)=>{
 const f=await fixture(t),first:Readonly<LoginChallenge>=await f.challenge('registered-user');await f.bootstrap(first,'registered-user');
 const known:Readonly<LoginChallenge>=await f.challenge('registered-user'),unknown:Readonly<LoginChallenge>=await f.challenge('unknown-user');
 assert.deepEqual(Object.keys(known).sort(),Object.keys(unknown).sort());
 assert.deepEqual([known.pollInterval,Math.abs(known.expiresAt-unknown.expiresAt)<=1000],[unknown.pollInterval,true]);
 assert.equal(new Set([known.pollToken,known.approvalToken,known.sessionToken]).size,3);
 for(const token of [known.approvalToken,known.sessionToken])assert.equal((await f.request(`/api/auth/challenges/${known.id}/poll`,'POST',{pollToken:token})).status,404);
 assert.equal((await f.request(`/api/auth/challenges/${known.id}/approve`,'POST',{approvalToken:known.pollToken},first.sessionToken)).status,404);
 assert.equal((await f.request(`/api/auth/challenges/${known.id}/approve`,'POST',{approvalToken:known.approvalToken})).status,401);
 assert.equal((await f.request(`/api/auth/challenges/${unknown.id}/inspect`,'POST',{approvalToken:unknown.approvalToken},first.sessionToken)).status,404);
 assert.equal((await f.request('/api/me','GET',undefined,known.sessionToken)).status,401);
});

await test('same-family approval works across users, is idempotent, and cannot reactivate a logged-out session',async(t)=>{
 const f=await fixture(t),first:Readonly<LoginChallenge>=await f.challenge('first-user');const owner:Readonly<{familyId:string;userId:string}>=await f.bootstrap(first,'first-user');
 const add=await f.request('/api/family/members','POST',{username:' Family_Member '},first.sessionToken);assert.equal(add.status,201);
 const added=await add.json() as Readonly<{user:Readonly<Identity['user']>}>;assert.deepEqual([added.user.username,added.user.familyId],['family_member',owner.familyId]);
 assert.equal((await f.request('/api/family/members','POST',{username:'elsewhere',familyId:'forged-family'},first.sessionToken)).status,400);
 const member:Readonly<LoginChallenge>=await f.challenge('family_member');
 assert.equal((await f.request('/api/me','GET',undefined,member.sessionToken)).status,401);
 const inspected=await f.request(`/api/auth/challenges/${member.id}/inspect`,'POST',{approvalToken:member.approvalToken},first.sessionToken);assert.equal(inspected.status,200);
 const inspection=await inspected.json() as Readonly<{username:string;verificationCode:string}>;assert.deepEqual([inspection.username,inspection.verificationCode],['family_member',member.verificationCode]);
 const approvals=await Promise.all([1,2].map(()=>f.request(`/api/auth/challenges/${member.id}/approve`,'POST',{approvalToken:member.approvalToken},first.sessionToken)));
 assert.deepEqual(approvals.map(r=>r.status),[200,200]);
 for(let i=0;i<2;i++)assert.deepEqual(await (await f.request(`/api/auth/challenges/${member.id}/poll`,'POST',{pollToken:member.pollToken})).json(),{status:'approved'});
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM sessions WHERE challenge_id=?').bind(member.id).first('n'),1);
 assert.equal((await f.request('/api/me','GET',undefined,member.sessionToken)).status,200);
 const family=await (await f.request('/api/family','GET',undefined,member.sessionToken)).json() as {members:Identity['user'][]};assert.equal(family.members.length,2);
 assert.equal((await f.request('/api/auth/logout','POST',{},member.sessionToken)).status,200);
 assert.equal((await f.request('/api/me','GET',undefined,member.sessionToken)).status,401);
 assert.equal((await f.request(`/api/auth/challenges/${member.id}/approve`,'POST',{approvalToken:member.approvalToken},first.sessionToken)).status,409);
 // Even cleanup removing the expired row must not make a replay activate it again.
 await f.db.prepare('DELETE FROM sessions WHERE expires_at=0').run();
 assert.equal((await f.request(`/api/auth/challenges/${member.id}/approve`,'POST',{approvalToken:member.approvalToken},first.sessionToken)).status,409);
 assert.equal((await f.request('/api/me','GET',undefined,member.sessionToken)).status,401);
});

await test('family members share existing and new schedules while only creators can change them',async(t)=>{
 const f=await fixture(t),first:Readonly<LoginChallenge>=await f.challenge('first-user');const owner:Readonly<{familyId:string;userId:string}>=await f.bootstrap(first,'first-user');
 await f.request('/api/family/members','POST',{username:'family-member'},first.sessionToken);
 const member:Readonly<LoginChallenge>=await f.challenge('family-member');await f.request(`/api/auth/challenges/${member.id}/approve`,'POST',{approvalToken:member.approvalToken},first.sessionToken);
 const outsider:Readonly<LoginChallenge>=await f.challenge('outsider-user'),familyId=randomUUID(),userId=randomUUID();
 await f.db.batch([
  f.db.prepare('INSERT INTO families (id,name) VALUES (?,?)').bind(familyId,'Other family'),
  f.db.prepare('INSERT INTO users (id,username,family_id) VALUES (?,?,?)').bind(userId,'outsider-user',familyId),
  f.db.prepare("UPDATE login_challenges SET status='approved',approved_user_id=?,approved_at=unixepoch() WHERE id=?").bind(userId,outsider.id)
 ]);
 const attempt:Readonly<LoginChallenge>=await f.challenge('family-member');
 for(const action of ['inspect','approve'])assert.equal((await f.request(`/api/auth/challenges/${attempt.id}/${action}`,'POST',{approvalToken:attempt.approvalToken},outsider.sessionToken)).status,404);
 assert.equal((await f.request('/api/me','GET',undefined,attempt.sessionToken)).status,401);
 const event:Readonly<EventInput>={title:'Family event',emoji:'🌿',color:'#7ba989',startAt:'2026-10-01T00:00:00Z',targetAt:'2026-12-01T00:00:00Z',repeatUnit:'none',repeatEvery:1,timeZone:'Asia/Tokyo'};
 const created=await f.request('/api/schedules','POST',event,first.sessionToken);assert.equal(created.status,201);
 const saved=await created.json() as Readonly<{event:Readonly<ScheduleRecord>}>;
 assert.deepEqual([saved.event.createdBy.username,saved.event.canEdit],['first-user',true]);
 const shared=await (await f.request('/api/schedules','GET',undefined,member.sessionToken)).json() as {events:ScheduleRecord[]};
 assert.deepEqual([shared.events.length,shared.events[0].id],[1,saved.event.id]);
 assert.deepEqual(shared.events[0].createdBy,saved.event.createdBy);assert.equal(shared.events[0].canEdit,false);
 // The legacy alias has the same sharing and permission rules.
 assert.deepEqual(await (await f.request('/api/events','GET',undefined,member.sessionToken)).json(),shared);
 assert.deepEqual(await (await f.request('/api/schedules','GET',undefined,outsider.sessionToken)).json(),{events:[]});
 assert.deepEqual(await (await f.request('/api/schedules?familyId='+owner.familyId,'GET',undefined,outsider.sessionToken)).json(),{events:[]});
 for(const token of [member.sessionToken,outsider.sessionToken]){
  assert.equal((await f.request('/api/schedules/'+saved.event.id,'PUT',{...event,title:'Stolen',canEdit:true},token)).status,404);
  assert.equal((await f.request('/api/schedules/'+saved.event.id,'DELETE',undefined,token)).status,404);
 }
 assert.equal((await f.request('/api/schedules/'+saved.event.id,'PUT',{...event,color:'red'},first.sessionToken)).status,400);
 const updated=await f.request('/api/schedules/'+saved.event.id,'PUT',{...event,title:'Updated'},first.sessionToken);
 assert.equal(updated.status,200);assert.equal(((await updated.json()) as {event:ScheduleRecord}).event.canEdit,true);
 const owned=await (await f.request('/api/schedules','GET',undefined,first.sessionToken)).json() as {events:ScheduleRecord[]};
 assert.deepEqual([owned.events[0].title,owned.events[0].canEdit],['Updated',true]);
 const refreshed=await (await f.request('/api/schedules','GET',undefined,member.sessionToken)).json() as {events:ScheduleRecord[]};assert.equal(refreshed.events[0].title,'Updated');
 // Member-created events are shared in the opposite direction, too.
 const memberCreated=await f.request('/api/schedules','POST',{...event,title:'Member event'},member.sessionToken);assert.equal(memberCreated.status,201);
 const memberEvent=((await memberCreated.json()) as {event:Readonly<ScheduleRecord>}).event;
 assert.deepEqual([memberEvent.canEdit,memberEvent.createdBy.username],[true,'family-member']);
 const combined=await (await f.request('/api/schedules','GET',undefined,first.sessionToken)).json() as {events:ScheduleRecord[]};
 assert.deepEqual([combined.events.length,combined.events.find((e:Readonly<ScheduleRecord>)=>e.id===memberEvent.id)?.canEdit],[2,false]);
 assert.equal((await f.request('/api/schedules/'+memberEvent.id,'DELETE',undefined,first.sessionToken)).status,404);
 assert.equal((await f.request('/api/schedules/'+saved.event.id,'DELETE',undefined,first.sessionToken)).status,200);
 assert.equal((await f.request('/api/schedules/'+memberEvent.id,'DELETE',undefined,member.sessionToken)).status,200);
 assert.deepEqual(await (await f.request('/api/schedules','GET',undefined,member.sessionToken)).json(),{events:[]});
});

await test('family schedule reads include existing events beyond the former 500-event read limit',async(t)=>{
 const f=await fixture(t),first:Readonly<LoginChallenge>=await f.challenge('first-user');const owner:Readonly<{familyId:string;userId:string}>=await f.bootstrap(first,'first-user');
 const added=await f.request('/api/family/members','POST',{username:'family-member'},first.sessionToken);
 const member=((await added.json()) as {user:Readonly<Identity['user']>}).user;
 await f.db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<501)
  INSERT INTO events (id,owner_id,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at)
  SELECT 'existing-'||n, CASE WHEN n<=500 THEN ? ELSE ? END, 'Existing '||n, '🌿', '#7ba989',
   '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'none', 1, 'UTC', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  FROM numbers`).bind(owner.userId,member.id).run();
 const result=await (await f.request('/api/schedules','GET',undefined,first.sessionToken)).json() as {events:ScheduleRecord[]};
 assert.equal(result.events.length,501);assert.equal(result.events.filter((e:Readonly<ScheduleRecord>)=>e.canEdit).length,500);
 assert.equal(result.events.find((e:Readonly<ScheduleRecord>)=>e.createdBy.id===member.id)?.canEdit,false);
 // Sharing does not increase a creator's write quota.
 assert.equal((await f.request('/api/schedules','POST',result.events[0],first.sessionToken)).status,409);
});

await test('expired challenges and sessions cannot be approved or authenticated, and concurrent bootstrap has one winner',async(t)=>{
 const f=await fixture(t),expired:Readonly<LoginChallenge>=await f.challenge('expired-user');
 await f.db.prepare('UPDATE login_challenges SET expires_at=unixepoch()-1 WHERE id=?').bind(expired.id).run();
 assert.deepEqual(await (await f.request(`/api/auth/challenges/${expired.id}/poll`,'POST',{pollToken:expired.pollToken})).json(),{status:'expired'});
 await assert.rejects(f.bootstrap(expired,'expired-user'));assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),0);
 const a:Readonly<LoginChallenge>=await f.challenge('candidate-alpha'),b:Readonly<LoginChallenge>=await f.challenge('candidate-bravo');
 const results=await Promise.allSettled([f.bootstrap(a,'candidate-alpha'),f.bootstrap(b,'candidate-bravo')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),1);assert.equal(await f.db.prepare('SELECT count(*) AS n FROM families').first('n'),1);
 const winner=results[0].status==='fulfilled'?a:b;
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM sessions').first('n'),1);
 assert.equal((await f.request('/api/me','GET',undefined,winner.sessionToken)).status,200);
 const knownExpired:Readonly<LoginChallenge>=await f.challenge(results[0].status==='fulfilled'?'candidate-alpha':'candidate-bravo');
 await f.db.prepare('UPDATE login_challenges SET expires_at=unixepoch()-1 WHERE id=?').bind(knownExpired.id).run();
 for(const action of ['inspect','approve'])assert.equal((await f.request(`/api/auth/challenges/${knownExpired.id}/${action}`,'POST',{approvalToken:knownExpired.approvalToken},winner.sessionToken)).status,404);
 assert.equal((await f.request('/api/me','GET',undefined,knownExpired.sessionToken)).status,401);
 await f.db.prepare('UPDATE sessions SET expires_at=unixepoch()-1').run();
 assert.equal((await f.request('/api/me','GET',undefined,winner.sessionToken)).status,401);
});

await test('origin checks, request bounds, malformed input and login rate limits are enforced',async(t)=>{
 const f=await fixture(t);
 const foreign=await f.request('/api/auth/challenges','POST',{username:'first-user'},undefined,'https://evil.example');assert.deepEqual([foreign.status,foreign.headers.get('Access-Control-Allow-Origin')],[403,null]);
 assert.equal((await f.request('/api/auth/challenges','POST',{username:'first-user'})).status,201);
 // Explicit raw request omits Origin; helper's default origin intentionally applies to UI requests.
 assert.equal((await f.mf.dispatchFetch('https://api.example/api/auth/challenges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'first-user'})})).status,403);
 const preflight=await f.request('/api/auth/challenges','OPTIONS');assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);assert.notEqual(preflight.headers.get('Access-Control-Allow-Origin'),'*');
 assert.equal((await f.request('/api/auth/challenges','POST',{username:'email@example.com'})).status,400);
 assert.equal((await f.request('/api/auth/challenges','POST',{username:'a'.repeat(9000)})).status,413);
 assert.equal((await f.request('/api/auth/challenges','POST',[])).status,400);
 for(let i=0;i<5;i++)await f.request('/api/auth/challenges','POST',{username:'rate-test-'+i});
 assert.equal((await f.request('/api/auth/challenges','POST',{username:'rate-over-limit'})).status,429);
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM users').first('n'),0);
});

await test('legacy events are preserved and require an explicit operator ownership claim',async(t)=>{
 const insertLegacy=async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.db.prepare("INSERT INTO legacy_events (id,owner,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(randomUUID(),'legacy@example.test','Preserved legacy event','🌿','#7ba989','2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','none',1,'UTC','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z').run();};
 const unclaimed=await fixture(t);await insertLegacy(unclaimed);const c:Readonly<LoginChallenge>=await unclaimed.challenge('first-user');await unclaimed.bootstrap(c,'first-user',0);
 assert.deepEqual(await (await unclaimed.request('/api/events','GET',undefined,c.sessionToken)).json(),{events:[]});
 assert.deepEqual(await (await unclaimed.request('/api/schedules','GET',undefined,c.sessionToken)).json(),{events:[]});assert.equal(await unclaimed.db.prepare('SELECT count(*) AS n FROM legacy_events').first('n'),1);
 const claimed=await fixture(t);await insertLegacy(claimed);const d:Readonly<LoginChallenge>=await claimed.challenge('first-user');await claimed.bootstrap(d,'first-user',1);
 const visible=await (await claimed.request('/api/schedules','GET',undefined,d.sessionToken)).json() as {events:{title:string}[]};assert.equal(visible.events[0].title,'Preserved legacy event');assert.equal(await claimed.db.prepare('SELECT count(*) AS n FROM legacy_events').first('n'),1);
});
