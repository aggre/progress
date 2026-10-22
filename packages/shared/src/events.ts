import { Temporal } from '@js-temporal/polyfill';
import { clamp } from 'ramda';
export const units = ['none', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const;
export type RepeatUnit = typeof units[number];
export interface ScheduleEvent {
  id: string; title: string; emoji: string; color: string; startAt: string;
  targetAt: string; repeatUnit: RepeatUnit; repeatEvery: number; timeZone: string;
  createdAt: string; updatedAt: string;
}
export type EventInput = Omit<ScheduleEvent, 'id' | 'createdAt' | 'updatedAt'>;
export const palette = ['#7ba989', '#b39bd5', '#dfad62', '#df947e', '#81aabb', '#c0a05c', '#82a8a0', '#b88cac'];
export function validateEvent(raw: unknown): EventInput {
  if (!raw || typeof raw !== 'object') throw new Error('Please enter an event.');
  const v = raw as Record<string, unknown>;
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.trim().length > 100) throw new Error('Use an event name between 1 and 100 characters.');
  if (typeof v.emoji !== 'string' || !v.emoji.trim() || [...v.emoji].length > 16) throw new Error('Choose an emoji (up to 16 characters).');
  if (typeof v.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(v.color)) throw new Error('Choose a valid six-digit color.');
  if (!units.includes(v.repeatUnit as RepeatUnit)) throw new Error('Choose a valid repeat period.');
  if (!Number.isInteger(v.repeatEvery) || Number(v.repeatEvery) < 1 || Number(v.repeatEvery) > 1000) throw new Error('Repeat every 1 to 1,000 periods.');
  if (typeof v.timeZone !== 'string' || v.timeZone.length > 80) throw new Error('Choose a valid time zone.');
  try { Temporal.Now.zonedDateTimeISO(v.timeZone); } catch { throw new Error('Choose a valid time zone.'); }
  if (typeof v.startAt !== 'string' || typeof v.targetAt !== 'string') throw new Error('Choose valid dates.');
  let start: Temporal.Instant, target: Temporal.Instant;
  try { start = Temporal.Instant.from(v.startAt); target = Temporal.Instant.from(v.targetAt); } catch { throw new Error('Choose valid dates.'); }
  if (Temporal.Instant.compare(start, target) >= 0) throw new Error('The target must be after the start.');
  // Limit the supported date range so recurrence arithmetic remains predictable.
  if (start.toZonedDateTimeISO(v.timeZone).year < 1900 || target.toZonedDateTimeISO(v.timeZone).year > 2200) throw new Error('Choose dates between 1900 and 2200.');
  return { title: v.title.trim(), emoji: v.emoji.trim(), color: v.color.toLowerCase(), startAt: start.toString(), targetAt: target.toString(), repeatUnit: v.repeatUnit as RepeatUnit, repeatEvery: Number(v.repeatEvery), timeZone: v.timeZone };
}
export function shift(target: string, zone: string, unit: RepeatUnit, amount: number): number {
  const anchor = Temporal.Instant.from(target).toZonedDateTimeISO(zone);
  if (unit === 'none') return anchor.epochMilliseconds;
  return anchor.add({ [`${unit}s`]: amount }, { overflow: 'constrain' }).epochMilliseconds;
}
export function cycle(event: EventInput, now: number) {
  let start = Date.parse(event.startAt), end = Date.parse(event.targetAt);
  if (event.repeatUnit !== 'none') {
    const at = (n: number) => shift(event.targetAt, event.timeZone, event.repeatUnit, n * event.repeatEvery);
    if (now < end) start = at(-1);
    else {
      // Find the occurrence using logarithmic search, always relative to the original anchor.
      let lo = 0, hi = 1;
      while (at(hi) <= now) { lo = hi; hi *= 2; }
      while (hi - lo > 1) { const mid = Math.floor((hi + lo) / 2); if (at(mid) <= now) lo = mid; else hi = mid; }
      start = at(lo); end = at(hi);
    }
  }
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
export function repeatLabel(e: EventInput): string {
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
  return examples.map(e=>({title:e.title,emoji:e.emoji,color:e.color,targetAt:e.target.toInstant().toString(),startAt:new Date(shift(e.target.toInstant().toString(),zone,e.unit as RepeatUnit,-1)).toISOString(),repeatUnit:e.unit as RepeatUnit,repeatEvery:1,timeZone:zone}));
}
