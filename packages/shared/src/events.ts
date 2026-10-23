import { Temporal } from '@js-temporal/polyfill';
import { clamp } from 'ramda';
export const units = ['none', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const;
export type RepeatUnit = typeof units[number];
export interface ScheduleEvent {
  readonly id: string; readonly title: string; readonly emoji: string; readonly color: string; readonly startAt: string;
  readonly targetAt: string; readonly repeatUnit: RepeatUnit; readonly repeatEvery: number; readonly timeZone: string;
  readonly createdAt: string; readonly updatedAt: string;
}
export type EventInput = Readonly<Omit<ScheduleEvent, 'id' | 'createdAt' | 'updatedAt'>>;
export const palette = ['#7ba989', '#b39bd5', '#dfad62', '#df947e', '#81aabb', '#c0a05c', '#82a8a0', '#b88cac'];
function invalidEvent(message: string): never { throw new Error(message); }
export function validateEvent(raw: unknown): EventInput {
  const v = !raw || typeof raw !== 'object' ? invalidEvent('Please enter an event.') : raw as Readonly<Record<string, unknown>>;
  const title = typeof v.title !== 'string' || !v.title.trim() || v.title.trim().length > 100
    ? invalidEvent('Use an event name between 1 and 100 characters.') : v.title;
  const emoji = typeof v.emoji !== 'string' || !v.emoji.trim() || [...v.emoji].length > 16
    ? invalidEvent('Choose an emoji (up to 16 characters).') : v.emoji;
  const color = typeof v.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(v.color)
    ? invalidEvent('Choose a valid six-digit color.') : v.color;
  const repeatUnit = units.includes(v.repeatUnit as RepeatUnit) ? v.repeatUnit as RepeatUnit : invalidEvent('Choose a valid repeat period.');
  const repeatEvery = !Number.isInteger(v.repeatEvery) || Number(v.repeatEvery) < 1 || Number(v.repeatEvery) > 1000
    ? invalidEvent('Repeat every 1 to 1,000 periods.') : Number(v.repeatEvery);
  const timeZone = typeof v.timeZone !== 'string' || v.timeZone.length > 80 ? invalidEvent('Choose a valid time zone.') : v.timeZone;
  try { Temporal.Now.zonedDateTimeISO(timeZone); } catch { throw new Error('Choose a valid time zone.'); }
  const {startAt, targetAt} = typeof v.startAt !== 'string' || typeof v.targetAt !== 'string'
    ? invalidEvent('Choose valid dates.') : {startAt: v.startAt, targetAt: v.targetAt};
  let start: Temporal.Instant, target: Temporal.Instant;
  try { start = Temporal.Instant.from(startAt); target = Temporal.Instant.from(targetAt); } catch { throw new Error('Choose valid dates.'); }
  // Limit the supported date range so recurrence arithmetic remains predictable.
  return Temporal.Instant.compare(start, target) >= 0 ? invalidEvent('The target must be after the start.')
    : start.toZonedDateTimeISO(timeZone).year < 1900 || target.toZonedDateTimeISO(timeZone).year > 2200
      ? invalidEvent('Choose dates between 1900 and 2200.')
      : { title: title.trim(), emoji: emoji.trim(), color: color.toLowerCase(), startAt: start.toString(), targetAt: target.toString(), repeatUnit, repeatEvery, timeZone };
}
export function shift(target: string, zone: string, unit: RepeatUnit, amount: number): number {
  const anchor = Temporal.Instant.from(target).toZonedDateTimeISO(zone);
  return unit === 'none' ? anchor.epochMilliseconds
    : anchor.add({ [`${unit}s`]: amount }, { overflow: 'constrain' }).epochMilliseconds;
}
function occurrenceIndices(at: (index: number) => number, now: number, lo = 0, hi = 1): Readonly<{lo: number; hi: number}> {
  const mid = Math.floor((hi + lo) / 2);
  return at(hi) <= now ? occurrenceIndices(at, now, hi, hi * 2)
    : hi - lo <= 1 ? {lo, hi}
    : at(mid) <= now ? occurrenceIndices(at, now, mid, hi)
    : occurrenceIndices(at, now, lo, mid);
}
function occurrenceBounds(at: (index: number) => number, now: number): Readonly<{start: number; end: number}> {
  // Find the occurrence using logarithmic search, always relative to the original anchor.
  const {lo, hi} = occurrenceIndices(at, now);
  return {start: at(lo), end: at(hi)};
}
export function cycle(event: Readonly<EventInput>, now: number) {
  const initialStart = Date.parse(event.startAt), initialEnd = Date.parse(event.targetAt);
  const at = (n: number) => shift(event.targetAt, event.timeZone, event.repeatUnit, n * event.repeatEvery);
  const {start, end} = event.repeatUnit === 'none' ? {start: initialStart, end: initialEnd}
    : now < initialEnd ? {start: at(-1), end: initialEnd}
    : occurrenceBounds(at, now);
  const progress = clamp(0, 100, (now - start) / (end - start) * 100);
  return { start, end, progress, remaining: Math.max(0, end - now), complete: event.repeatUnit === 'none' && now >= end, upcoming: now < start } as const;
}
export function remainingText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60), sec = seconds % 60;
  return days ? `${days.toLocaleString('en-US')}d ${hours}h ${minutes}m`
    : hours ? `${hours}h ${minutes}m ${sec}s`
    : minutes ? `${minutes}m ${sec}s`
    : `${sec}s`;
}
export function repeatLabel(e: Readonly<EventInput>): string {
  return e.repeatUnit === 'none' ? 'One-time'
    : `Every ${e.repeatEvery === 1 ? '' : e.repeatEvery + ' '}${e.repeatUnit}${e.repeatEvery === 1 ? '' : 's'}`;
}
export function toLocal(instant: string, zone: string) { return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: 'minute' }); }
export function fromLocal(value: string, zone: string) { return Temporal.PlainDateTime.from(value).toZonedDateTime(zone, { disambiguation: 'compatible' }).toInstant().toString(); }
export function starterEvents(zone: string): EventInput[] {
  const now = Temporal.Now.zonedDateTimeISO(zone);
  const day = now.startOfDay();
  const endWeek = day.add({ days: (6 - day.dayOfWeek + 7) % 7 || 7 });
  const examples = [
    {title:'Next minute',emoji:'⏱️',color:palette[0],target:now.round({smallestUnit:'minute',roundingMode:'floor'}).add({minutes:1}),unit:'minute'},
    {title:'A fresh day',emoji:'☀️',color:palette[2],target:day.add({days:1}),unit:'day'},
    {title:'Hello, weekend',emoji:'🌿',color:palette[0],target:endWeek,unit:'week'},
    {title:'A new month',emoji:'🌙',color:palette[1],target:day.with({day:1}).add({months:1}),unit:'month'},
    {title:'The next chapter',emoji:'🎉',color:palette[3],target:day.with({month:1,day:1}).add({years:1}),unit:'year'},
    {title:"St. Patrick’s Day",emoji:'☘️',color:palette[6],target:day.with({month:3,day:17}).add({years:now.month > 3 || (now.month === 3 && now.day >= 17) ? 1 : 0}),unit:'year'}
  ];
  return examples.map((e): Readonly<EventInput>=>({title:e.title,emoji:e.emoji,color:e.color,targetAt:e.target.toInstant().toString(),startAt:new Date(shift(e.target.toInstant().toString(),zone,e.unit as RepeatUnit,-1)).toISOString(),repeatUnit:e.unit as RepeatUnit,repeatEvery:1,timeZone:zone}));
}
