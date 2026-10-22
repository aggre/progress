import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycle, fromLocal, shift, validateEvent, remainingText, starterEvents, type EventInput } from '../packages/shared/src/events';
const event: Readonly<EventInput> = { title:'Deadline',emoji:'✨',color:'#7ba989',startAt:'2026-01-01T00:00:00Z',targetAt:'2026-01-02T00:00:00Z',repeatUnit:'none',repeatEvery:1,timeZone:'UTC' };
test('one-time progress clamps before start and after completion',()=>{
  assert.equal(cycle(event,Date.parse('2025-12-31T00:00Z')).progress,0);
  assert.equal(cycle(event,Date.parse('2026-01-01T12:00Z')).progress,50);
  assert.equal(cycle(event,Date.parse(event.targetAt)).complete,true);
  assert.equal(cycle(event,Date.parse('2027-01-01T00:00Z')).progress,100);
});
test('recurrence advances exactly at the boundary',()=>{
  const e={...event,repeatUnit:'minute' as const};
  const c=cycle(e,Date.parse(e.targetAt));assert.equal(c.progress,0);assert.equal(c.remaining,60000);
  assert.equal(cycle(e,Date.parse(e.targetAt)+30000).progress,50);
});
test('old minutely schedules jump efficiently without drift',()=>{
  const e={...event,targetAt:'2000-01-01T00:00:00Z',repeatUnit:'minute' as const,repeatEvery:7};
  const c=cycle(e,Date.parse('2026-10-21T12:34:56Z'));
  assert.ok(c.end>Date.parse('2026-10-21T12:34:56Z'));assert.equal((c.end-Date.parse(e.targetAt))%(7*60000),0);
});
test('January 31 remains anchored after February',()=>{
  const e={...event,targetAt:'2026-01-31T10:00:00Z',repeatUnit:'month' as const};
  assert.equal(new Date(cycle(e,Date.parse('2026-02-01T00:00Z')).end).toISOString(),'2026-02-28T10:00:00.000Z');
  assert.equal(new Date(cycle(e,Date.parse('2026-03-01T00:00Z')).end).toISOString(),'2026-03-31T10:00:00.000Z');
});
test('leap-day recurrence recovers February 29 in leap years',()=>{
  const e={...event,startAt:'2023-02-28T00:00:00Z',targetAt:'2024-02-29T00:00:00Z',repeatUnit:'year' as const};
  assert.equal(new Date(cycle(e,Date.parse('2027-03-01T00:00Z')).end).toISOString(),'2028-02-29T00:00:00.000Z');
});
test('daily wall-clock recurrence follows daylight saving',()=>{
  const e={...event,targetAt:fromLocal('2026-03-07T09:00','America/New_York'),repeatUnit:'day' as const,timeZone:'America/New_York'};
  const c=cycle(e,Date.parse('2026-03-08T00:00Z'));
  assert.equal(c.end-c.start,23*3600000);
  assert.equal(new Date(c.end).toISOString(),'2026-03-08T13:00:00.000Z');
  const fall={...e,targetAt:fromLocal('2026-10-31T09:00','America/New_York')};
  const f=cycle(fall,Date.parse('2026-11-01T00:00Z'));assert.equal(f.end-f.start,25*3600000);
});
test('future recurring events keep their first target',()=>{
  const e={...event,targetAt:'2027-01-01T00:00:00Z',repeatUnit:'month' as const};
  const c=cycle(e,Date.parse('2026-01-01T00:00Z'));assert.equal(c.progress,0);assert.equal(c.end,Date.parse(e.targetAt));
});
test('calendar intervals and timezone conversion',()=>{
  assert.equal(new Date(shift('2026-01-31T00:00Z','UTC','month',2)).toISOString(),'2026-03-31T00:00:00.000Z');
  assert.equal(fromLocal('2026-10-22T00:00','Asia/Tokyo'),'2026-10-21T15:00:00Z');
  assert.equal(remainingText(1),'1s');assert.equal(remainingText(0),'0s');
});
test('validates dates, colors, names, intervals and timezone',()=>{
  assert.equal(validateEvent(event).title,'Deadline');
  for (const invalid of [{title:''},{color:'red'},{repeatEvery:0},{repeatEvery:1.5},{repeatUnit:'fortnight'},{timeZone:'Not/AZone'},{startAt:event.targetAt},{targetAt:'invalid'}]) assert.throws(()=>validateEvent({...event,...invalid}));
});
test('all starter events are valid',()=>{for(const e of starterEvents('Asia/Tokyo')) assert.doesNotThrow(()=>validateEvent(e));});
