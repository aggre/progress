import { palette, validateEvent, type EventInput } from './events';

export interface TimerPreset {
  readonly id: string;
  readonly title: string;
  readonly emoji: string;
  readonly color: string;
}

export const MAX_TIMER_MINUTES = 240;

export const timerPresets: Readonly<Record<number, TimerPreset>> = Object.fromEntries([
  { id: 'game', title: 'Game time', emoji: '🎮', color: palette[0] },
  { id: 'video', title: 'Video time', emoji: '📺', color: palette[1] },
  { id: 'reading', title: 'Reading', emoji: '📖', color: palette[2] },
  { id: 'play', title: 'Play & build', emoji: '🎨', color: palette[3] },
  { id: 'cleanup', title: 'Clean up', emoji: '🧹', color: palette[6] },
  { id: 'homework', title: 'Homework', emoji: '✏️', color: palette[5] },
  { id: 'bath', title: 'Bath & ready', emoji: '🛁', color: palette[4] },
].entries());

export const timerDurations: Readonly<Record<number, number>> = Object.fromEntries([5, 10, 15, 30, 45, 60].entries());

export function timerDurationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours < 1 ? `${minutes} min`
    : rest === 0 ? `${hours} hr`
    : `${hours} hr ${rest} min`;
}

export function buildQuickTimer(data: Readonly<Record<string, unknown>>, nowMs: number): EventInput | Readonly<{ error: string }> {
  const minutes = data.minutes;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const emoji = typeof data.emoji === 'string' && data.emoji.trim() ? data.emoji.trim() : '⏱️';
  const color = typeof data.color === 'string' ? data.color : palette[0];
  const timeZone = typeof data.timeZone === 'string' && data.timeZone ? data.timeZone : 'Asia/Tokyo';
  return Object.keys(data).some(key => !['title', 'emoji', 'color', 'minutes', 'timeZone'].includes(key))
    ? { error: 'Only a timer name, emoji, color, duration, and time zone are accepted.' }
    : !Number.isFinite(nowMs) ? { error: 'Choose a valid start time.' }
    : typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIMER_MINUTES
      ? { error: `Choose a timer between 1 and ${MAX_TIMER_MINUTES} whole minutes.` }
      : validateEvent({
        title,
        emoji,
        color,
        startAt: new Date(nowMs).toISOString(),
        targetAt: new Date(nowMs + minutes * 60_000).toISOString(),
        repeatUnit: 'none',
        repeatEvery: 1,
        timeZone,
      });
}

export function isQuickTimer(event: Readonly<Pick<EventInput, 'startAt' | 'targetAt' | 'repeatUnit'> & { activity?: unknown }>): boolean {
  const durationMs = Date.parse(event.targetAt) - Date.parse(event.startAt);
  return !event.activity && event.repeatUnit === 'none' && durationMs >= 60_000 && durationMs <= MAX_TIMER_MINUTES * 60_000;
}

export function timerTotalMinutes(event: Readonly<Pick<EventInput, 'startAt' | 'targetAt'>>): number {
  return Math.max(1, Math.round((Date.parse(event.targetAt) - Date.parse(event.startAt)) / 60_000));
}

export function extendQuickTimer(event: Readonly<EventInput>, extraMinutes: number, nowMs: number): EventInput | Readonly<{ error: string }> {
  const baseMs = Math.max(Date.parse(event.targetAt), nowMs);
  const nextTargetMs = baseMs + extraMinutes * 60_000;
  const totalMinutes = Math.round((nextTargetMs - Date.parse(event.startAt)) / 60_000);
  return !Number.isInteger(extraMinutes) || extraMinutes < 1 || extraMinutes > 60
    ? { error: 'Add between 1 and 60 whole minutes.' }
    : totalMinutes > MAX_TIMER_MINUTES
      ? { error: `A quick timer can run for up to ${MAX_TIMER_MINUTES} minutes.` }
      : validateEvent({ ...event, targetAt: new Date(nextTargetMs).toISOString() });
}
