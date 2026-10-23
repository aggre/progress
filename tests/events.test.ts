import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycle, fromLocal, shift, validateEvent, remainingText, starterEvents, type EventInput } from '../packages/shared/src/events';
const event: Readonly<EventInput> = { title:'Deadline',emoji:'✨',color:'#7ba989',startAt:'2026-01-01T00:00:00Z',targetAt:'2026-01-02T00:00:00Z',repeatUnit:'none',repeatEvery:1,timeZone:'UTC' };
await test('one-time progress clamps before start and after completion',()=>{
  assert.equal(cycle(event,Date.parse('2025-12-31T00:00Z')).progress,0);
  assert.equal(cycle(event,Date.parse('2026-01-01T12:00Z')).progress,50);
  assert.equal(cycle(event,Date.parse(event.targetAt)).complete,true);
  assert.equal(cycle(event,Date.parse('2027-01-01T00:00Z')).progress,100);
});
await test('recurrence advances exactly at the boundary',()=>{
  const e: Readonly<EventInput>={...event,repeatUnit:'minute'};
  const c=cycle(e,Date.parse(e.targetAt));assert.equal(c.progress,0);assert.equal(c.remaining,60000);
  assert.equal(cycle(e,Date.parse(e.targetAt)+30000).progress,50);
});
await test('old minutely schedules jump efficiently without drift',()=>{
  const e: Readonly<EventInput>={...event,targetAt:'2000-01-01T00:00:00Z',repeatUnit:'minute',repeatEvery:7};
  const c=cycle(e,Date.parse('2026-10-21T12:34:56Z'));
  assert.ok(c.end>Date.parse('2026-10-21T12:34:56Z'));assert.equal((c.end-Date.parse(e.targetAt))%(7*60000),0);
});
await test('January 31 remains anchored after February',()=>{
  const e: Readonly<EventInput>={...event,targetAt:'2026-01-31T10:00:00Z',repeatUnit:'month'};
  assert.equal(new Date(cycle(e,Date.parse('2026-02-01T00:00Z')).end).toISOString(),'2026-02-28T10:00:00.000Z');
  assert.equal(new Date(cycle(e,Date.parse('2026-03-01T00:00Z')).end).toISOString(),'2026-03-31T10:00:00.000Z');
});
await test('leap-day recurrence recovers February 29 in leap years',()=>{
  const e: Readonly<EventInput>={...event,startAt:'2023-02-28T00:00:00Z',targetAt:'2024-02-29T00:00:00Z',repeatUnit:'year'};
  assert.equal(new Date(cycle(e,Date.parse('2027-03-01T00:00Z')).end).toISOString(),'2028-02-29T00:00:00.000Z');
});
await test('daily wall-clock recurrence follows daylight saving',()=>{
  const e: Readonly<EventInput>={...event,targetAt:fromLocal('2026-03-07T09:00','America/New_York'),repeatUnit:'day',timeZone:'America/New_York'};
  const c=cycle(e,Date.parse('2026-03-08T00:00Z'));
  assert.equal(c.end-c.start,23*3600000);
  assert.equal(new Date(c.end).toISOString(),'2026-03-08T13:00:00.000Z');
  const fall: Readonly<EventInput>={...e,targetAt:fromLocal('2026-10-31T09:00','America/New_York')};
  const f=cycle(fall,Date.parse('2026-11-01T00:00Z'));assert.equal(f.end-f.start,25*3600000);
});
await test('future recurring events keep their first target',()=>{
  const e: Readonly<EventInput>={...event,targetAt:'2027-01-01T00:00:00Z',repeatUnit:'month'};
  const c=cycle(e,Date.parse('2026-01-01T00:00Z'));assert.equal(c.progress,0);assert.equal(c.end,Date.parse(e.targetAt));
});
await test('calendar intervals and timezone conversion',()=>{
  assert.equal(new Date(shift('2026-01-31T00:00Z','UTC','month',2)).toISOString(),'2026-03-31T00:00:00.000Z');
  assert.equal(fromLocal('2026-10-22T00:00','Asia/Tokyo'),'2026-10-21T15:00:00Z');
  assert.equal(remainingText(1),'1s');assert.equal(remainingText(0),'0s');
});
await test('validates dates, colors, names, intervals and timezone',()=>{
  assert.equal(validateEvent(event).title,'Deadline');
  for (const invalid of [{title:''},{color:'red'},{repeatEvery:0},{repeatEvery:1.5},{repeatUnit:'fortnight'},{timeZone:'Not/AZone'},{startAt:event.targetAt},{targetAt:'invalid'}] as const) assert.throws((): Readonly<EventInput>=>validateEvent({...event,...invalid}));
});
await test('all starter events are valid',()=>{for(const e of starterEvents('Asia/Tokyo') as Readonly<EventInput>[]) assert.doesNotThrow((): Readonly<EventInput>=>validateEvent(e));});
