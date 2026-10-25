import { Temporal } from '@js-temporal/polyfill';
import { clamp } from 'ramda';
export const units = { none: 'none', minute: 'minute', hour: 'hour', day: 'day', week: 'week', month: 'month', year: 'year' } as const;
export type RepeatUnit = typeof units[keyof typeof units];
export interface ScheduleEvent {
  readonly id: string; readonly title: string; readonly emoji: string; readonly color: string; readonly startAt: string;
  readonly targetAt: string; readonly repeatUnit: RepeatUnit; readonly repeatEvery: number; readonly timeZone: string;
  readonly createdAt: string; readonly updatedAt: string;
}
export type EventInput = Readonly<Omit<ScheduleEvent, 'id' | 'createdAt' | 'updatedAt'>>;
export const palette: Readonly<Record<number, string>> = Object.fromEntries(['#7ba989', '#b39bd5', '#dfad62', '#df947e', '#81aabb', '#c0a05c', '#82a8a0', '#b88cac'].entries());
function invalidEvent(message: string): never { throw new Error(message); }
function instantNanoseconds(value: string): bigint {
  try { return Temporal.Instant.from(value).epochNanoseconds; }
  catch { return invalidEvent('Choose valid dates.'); }
}
function validTimeZone(value: string): boolean {
  try { return Boolean(Temporal.Instant.fromEpochNanoseconds(0n).toZonedDateTimeISO(value).timeZoneId); }
  catch { return false; }
}
export function validateEvent(raw: unknown): EventInput {
  const v = !raw || typeof raw !== 'object' ? invalidEvent('Please enter an event.') : raw as Readonly<Record<string, unknown>>;
  const title = typeof v.title !== 'string' || !v.title.trim() || v.title.trim().length > 100
    ? invalidEvent('Use an event name between 1 and 100 characters.') : v.title;
  const emoji = typeof v.emoji !== 'string' || !v.emoji.trim() || [...v.emoji].length > 16
    ? invalidEvent('Choose an emoji (up to 16 characters).') : v.emoji;
  const color = typeof v.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(v.color)
    ? invalidEvent('Choose a valid six-digit color.') : v.color;
  const repeatUnit = Object.values(units).includes(v.repeatUnit as RepeatUnit) ? v.repeatUnit as RepeatUnit : invalidEvent('Choose a valid repeat period.');
  const repeatEvery = !Number.isInteger(v.repeatEvery) || Number(v.repeatEvery) < 1 || Number(v.repeatEvery) > 1000
    ? invalidEvent('Repeat every 1 to 1,000 periods.') : Number(v.repeatEvery);
  const timeZone = typeof v.timeZone !== 'string' || v.timeZone.length > 80 || !validTimeZone(v.timeZone) ? invalidEvent('Choose a valid time zone.') : v.timeZone;
  const {startAt, targetAt} = typeof v.startAt !== 'string' || typeof v.targetAt !== 'string'
    ? invalidEvent('Choose valid dates.') : {startAt: v.startAt, targetAt: v.targetAt};
  // Keep parsed instants as immutable nanoseconds throughout validation.
  const start = instantNanoseconds(startAt), target = instantNanoseconds(targetAt);
  // Limit the supported date range so recurrence arithmetic remains predictable.
  return start >= target ? invalidEvent('The target must be after the start.')
    : Temporal.Instant.fromEpochNanoseconds(start).toZonedDateTimeISO(timeZone).year < 1900 || Temporal.Instant.fromEpochNanoseconds(target).toZonedDateTimeISO(timeZone).year > 2200
      ? invalidEvent('Choose dates between 1900 and 2200.')
      : { title: title.trim(), emoji: emoji.trim(), color: color.toLowerCase(), startAt: Temporal.Instant.fromEpochNanoseconds(start).toString(), targetAt: Temporal.Instant.fromEpochNanoseconds(target).toString(), repeatUnit, repeatEvery, timeZone };
}
export function shift(target: string, zone: string, unit: RepeatUnit, amount: number): number {
  return unit === 'none'
    ? Temporal.Instant.from(target).toZonedDateTimeISO(zone).epochMilliseconds
    : Temporal.Instant.from(target).toZonedDateTimeISO(zone).add({ [`${unit}s`]: amount }, { overflow: 'constrain' }).epochMilliseconds;
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
  const now = Temporal.Now.zonedDateTimeISO(zone).toString();
  const day = Temporal.ZonedDateTime.from(now).startOfDay().toString();
  const endWeek = Temporal.ZonedDateTime.from(day).add({ days: (6 - Temporal.ZonedDateTime.from(day).dayOfWeek + 7) % 7 || 7 }).toInstant().toString();
  const examples: Readonly<Record<string, Readonly<{title:string; emoji:string; color:string; target:string; unit:RepeatUnit}>>> = {
    minute: {title:'Next minute',emoji:'⏱️',color:palette[0],target:Temporal.ZonedDateTime.from(now).round({smallestUnit:'minute',roundingMode:'floor'}).add({minutes:1}).toInstant().toString(),unit:'minute'},
    day: {title:'A fresh day',emoji:'☀️',color:palette[2],target:Temporal.ZonedDateTime.from(day).add({days:1}).toInstant().toString(),unit:'day'},
    week: {title:'Hello, weekend',emoji:'🌿',color:palette[0],target:endWeek,unit:'week'},
    month: {title:'A new month',emoji:'🌙',color:palette[1],target:Temporal.ZonedDateTime.from(day).with({day:1}).add({months:1}).toInstant().toString(),unit:'month'},
    year: {title:'The next chapter',emoji:'🎉',color:palette[3],target:Temporal.ZonedDateTime.from(day).with({month:1,day:1}).add({years:1}).toInstant().toString(),unit:'year'},
    saintPatricksDay: {title:"St. Patrick’s Day",emoji:'☘️',color:palette[6],target:Temporal.ZonedDateTime.from(day).with({month:3,day:17}).add({years:Temporal.ZonedDateTime.from(now).month > 3 || (Temporal.ZonedDateTime.from(now).month === 3 && Temporal.ZonedDateTime.from(now).day >= 17) ? 1 : 0}).toInstant().toString(),unit:'year'},
  };
  return Object.values(examples).map((e): Readonly<EventInput>=>({title:e.title,emoji:e.emoji,color:e.color,targetAt:e.target,startAt:new Date(shift(e.target,zone,e.unit,-1)).toISOString(),repeatUnit:e.unit,repeatEvery:1,timeZone:zone}));
}
