import { cycle, type ScheduleEvent } from './events';

export const reminderTimes = { 1: '1 minute', 5: '5 minutes', 10: '10 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour' } as const;
export type ReminderMinutes = keyof typeof reminderTimes;
export interface ReminderPreferences { readonly enabled: boolean; readonly minutes: ReminderMinutes; }
export const defaultPreferences: ReminderPreferences = { enabled: false, minutes: 10 };
export type DeliveryHistory = Readonly<Record<string, number>>;
export interface Reminder { readonly event: ScheduleEvent; readonly end: number; }

export function parsePreferences(value: unknown): ReminderPreferences {
  const data = value && typeof value === 'object' ? value as Readonly<Record<string, unknown>> : {};
  return {
    enabled: data.enabled === true,
    minutes: typeof data.minutes === 'number' && Object.hasOwn(reminderTimes, data.minutes) ? data.minutes as ReminderMinutes : 10,
  };
}

export function parseHistory(value: unknown): DeliveryHistory {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    : {};
}

export function dueReminders(events: Readonly<Record<number, ScheduleEvent>>, now: number, preferences: ReminderPreferences, history: DeliveryHistory): Readonly<Record<number, Reminder>> {
  return Object.fromEntries((preferences.enabled ? Object.values(events).map((event): Reminder => ({ event, end: cycle(event, now).end }))
    .filter(({ event, end }: Reminder) => end > now && end - now <= preferences.minutes * 60_000 && history[event.id] !== end) : []).entries());
}

export function rememberDelivery(history: DeliveryHistory, reminder: Reminder, now: number): DeliveryHistory {
  return { ...Object.fromEntries(Object.entries(history).filter((entry: Readonly<{ 0: string; 1: number }>) => entry[1] > now)), [reminder.event.id]: reminder.end };
}
