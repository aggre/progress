import { Hono } from 'hono';
import { validateEvent,type ScheduleEvent } from '@little/shared/events';
import { jsonObject,requireAuth,throttle } from './security';
import type { AppEnv } from './types';
interface Row { id:string;title:string;emoji:string;color:string;start_at:string;target_at:string;repeat_unit:ScheduleEvent['repeatUnit'];repeat_every:number;time_zone:string;created_at:string;updated_at:string; }
function map(r:Row):ScheduleEvent{return {id:r.id,title:r.title,emoji:r.emoji,color:r.color,startAt:r.start_at,targetAt:r.target_at,repeatUnit:r.repeat_unit,repeatEvery:r.repeat_every,timeZone:r.time_zone,createdAt:r.created_at,updatedAt:r.updated_at};}
export const events=new Hono<AppEnv>();events.use('*',requireAuth);
events.get('/',async c=>{const r=await c.env.DB.prepare('SELECT * FROM events WHERE owner_id=? ORDER BY created_at,id LIMIT 500').bind(c.get('identity').user.id).all<Row>();return c.json({events:r.results.map(map)});});
events.post('/',async c=>{
 const owner=c.get('identity').user.id;if(!await throttle(c,'event-write',60,60,owner))return c.json({error:'Please slow down.'},429);
 let input;try{input=validateEvent(await jsonObject(c));}catch(e){return c.json({error:e instanceof Error?e.message:'Invalid event.'},400);}
 const id=crypto.randomUUID(),stamp=new Date().toISOString();
 const r=await c.env.DB.prepare('INSERT INTO events (id,owner_id,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM events WHERE owner_id=?)<500').bind(id,owner,input.title,input.emoji,input.color,input.startAt,input.targetAt,input.repeatUnit,input.repeatEvery,input.timeZone,stamp,stamp,owner).run();
 if(!r.meta.changes)return c.json({error:'You have reached the limit of 500 events.'},409);
 return c.json({event:{id,...input,createdAt:stamp,updatedAt:stamp}},201);
});
events.put('/:id',async c=>{
 const owner=c.get('identity').user.id;if(!await throttle(c,'event-write',60,60,owner))return c.json({error:'Please slow down.'},429);
 let input;try{input=validateEvent(await jsonObject(c));}catch(e){return c.json({error:e instanceof Error?e.message:'Invalid event.'},400);}
 const id=c.req.param('id'),stamp=new Date().toISOString();
 const r=await c.env.DB.prepare('UPDATE events SET title=?,emoji=?,color=?,start_at=?,target_at=?,repeat_unit=?,repeat_every=?,time_zone=?,updated_at=? WHERE id=? AND owner_id=?').bind(input.title,input.emoji,input.color,input.startAt,input.targetAt,input.repeatUnit,input.repeatEvery,input.timeZone,stamp,id,owner).run();
 if(!r.meta.changes)return c.json({error:'This event no longer exists.'},404);
 const row=await c.env.DB.prepare('SELECT * FROM events WHERE id=? AND owner_id=?').bind(id,owner).first<Row>();return c.json({event:row?map(row):null});
});
events.delete('/:id',async c=>{
 const owner=c.get('identity').user.id;if(!await throttle(c,'event-write',60,60,owner))return c.json({error:'Please slow down.'},429);
 const r=await c.env.DB.prepare('DELETE FROM events WHERE id=? AND owner_id=?').bind(c.req.param('id'),owner).run();return r.meta.changes?c.json({ok:true}):c.json({error:'This event no longer exists.'},404);
});
