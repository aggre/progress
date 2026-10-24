import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycle, fromLocal, shift, validateEvent, remainingText, starterEvents, type EventInput } from '../packages/shared/src/events';
const event: Readonly<EventInput> = { title:'Deadline',emoji:'✨',color:'#7ba989',startAt:'2026-01-01T00:00:00Z',targetAt:'2026-01-02T00:00:00Z',repeatUnit:'none',repeatEvery:1,timeZone:'UTC' };
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('one-time progress clamps before start and after completion',()=>{
  assert.deepEqual([
    cycle(event,Date.parse('2025-12-31T00:00Z')).progress,
    cycle(event,Date.parse('2026-01-01T12:00Z')).progress,
    cycle(event,Date.parse(event.targetAt)).complete,
    cycle(event,Date.parse('2027-01-01T00:00Z')).progress,
  ],[0,50,true,100]);
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('recurrence advances exactly at the boundary',()=>{
  const e: Readonly<EventInput>={...event,repeatUnit:'minute'};
  const c=cycle(e,Date.parse(e.targetAt));
  assert.deepEqual([c.progress,c.remaining,cycle(e,Date.parse(e.targetAt)+30000).progress],[0,60000,50]);
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('old minutely schedules jump efficiently without drift',()=>{
  const e: Readonly<EventInput>={...event,targetAt:'2000-01-01T00:00:00Z',repeatUnit:'minute',repeatEvery:7};
  const c=cycle(e,Date.parse('2026-10-21T12:34:56Z'));
  assert.deepEqual([c.end>Date.parse('2026-10-21T12:34:56Z'),(c.end-Date.parse(e.targetAt))%(7*60000)],[true,0]);
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('January 31 remains anchored after February',()=>{
  const e: Readonly<EventInput>={...event,targetAt:'2026-01-31T10:00:00Z',repeatUnit:'month'};
  assert.deepEqual([
    new Date(cycle(e,Date.parse('2026-02-01T00:00Z')).end).toISOString(),
    new Date(cycle(e,Date.parse('2026-03-01T00:00Z')).end).toISOString(),
  ],['2026-02-28T10:00:00.000Z','2026-03-31T10:00:00.000Z']);
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('leap-day recurrence recovers February 29 in leap years',()=>{
  const e: Readonly<EventInput>={...event,startAt:'2023-02-28T00:00:00Z',targetAt:'2024-02-29T00:00:00Z',repeatUnit:'year'};
  assert.equal(new Date(cycle(e,Date.parse('2027-03-01T00:00Z')).end).toISOString(),'2028-02-29T00:00:00.000Z');
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('daily wall-clock recurrence follows daylight saving',()=>{
  const e: Readonly<EventInput>={...event,targetAt:fromLocal('2026-03-07T09:00','America/New_York'),repeatUnit:'day',timeZone:'America/New_York'};
  const c=cycle(e,Date.parse('2026-03-08T00:00Z'));
  assert.deepEqual([c.end-c.start,new Date(c.end).toISOString()],[23*3600000,'2026-03-08T13:00:00.000Z']);
  const fall: Readonly<EventInput>={...e,targetAt:fromLocal('2026-10-31T09:00','America/New_York')};
  const f=cycle(fall,Date.parse('2026-11-01T00:00Z'));assert.equal(f.end-f.start,25*3600000);
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('future recurring events keep their first target',()=>{
  const e: Readonly<EventInput>={...event,targetAt:'2027-01-01T00:00:00Z',repeatUnit:'month'};
  const c=cycle(e,Date.parse('2026-01-01T00:00Z'));assert.deepEqual([c.progress,c.end],[0,Date.parse(e.targetAt)]);
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('calendar intervals and timezone conversion',()=>{
  assert.deepEqual([
    new Date(shift('2026-01-31T00:00Z','UTC','month',2)).toISOString(),
    fromLocal('2026-10-22T00:00','Asia/Tokyo'),
    remainingText(1),remainingText(0),
  ],['2026-03-31T00:00:00.000Z','2026-10-21T15:00:00Z','1s','0s']);
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('validates dates, colors, names, intervals and timezone',()=>{
  assert.equal(validateEvent(event).title,'Deadline');
  // eslint-disable-next-line functional/functional-parameters -- The assertion API invokes this parameterless callback to capture the expected validation exception.
  for (const invalid of [{title:''},{color:'red'},{repeatEvery:0},{repeatEvery:1.5},{repeatUnit:'fortnight'},{timeZone:'Not/AZone'},{startAt:event.targetAt},{targetAt:'invalid'}] as const) assert.throws((): Readonly<EventInput>=>validateEvent({...event,...invalid}));
});
// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register this runner lifecycle callback; it needs no context argument and reports assertion results without a return value.
await test('all starter events are valid',()=>{
  // eslint-disable-next-line functional/functional-parameters -- The assertion API invokes this parameterless callback to capture any unexpected validation exception.
  for(const e of starterEvents('Asia/Tokyo') as Readonly<EventInput>[]) assert.doesNotThrow((): Readonly<EventInput>=>validateEvent(e));
});
