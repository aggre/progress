import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromLocal, type ScheduleEvent } from '../packages/shared/src/events';
import { defaultPreferences, dueReminders, parseHistory, parsePreferences, rememberDelivery } from '../apps/web/src/lib/reminders';

const event: ScheduleEvent = { id: 'event-1', title: 'Family dinner', emoji: '✨', color: '#7ba989', startAt: '2026-01-01T00:00:00Z', targetAt: '2026-01-02T00:00:00Z', repeatUnit: 'none', repeatEvery: 1, timeZone: 'UTC', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const enabled = { enabled: true, minutes: 10 } as const;
const end = Date.parse(event.targetAt);

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register a runner callback for reminder boundary assertions.
await test('reminders are opt-in and include the exact lead-time boundary but exclude past events', () => {
  return assert.deepEqual([
    Object.values(dueReminders([event], end - 600_000, defaultPreferences, {})).length,
    Object.values(dueReminders([event], end - 600_001, enabled, {})).length,
    Object.values(dueReminders([event], end - 600_000, enabled, {})).length,
    Object.values(dueReminders([event], end - 1, enabled, {})).length,
    Object.values(dueReminders([event], end, enabled, {})).length,
    Object.values(dueReminders([event], end + 60_000, enabled, {})).length,
  ], [0, 0, 1, 1, 0, 0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register a runner callback for persisted preference validation.
await test('saved preferences require explicit opt-in and a supported lead time', () => {
  return assert.deepEqual([
    parsePreferences(null), parsePreferences('invalid'), parsePreferences({ enabled: 'true', minutes: -10 }),
    parsePreferences({ enabled: true, minutes: 5 }), parsePreferences({ enabled: false, minutes: 60 }),
    parsePreferences({ enabled: true, minutes: '5' }),
  ], [defaultPreferences, defaultPreferences, defaultPreferences, { enabled: true, minutes: 5 }, { enabled: false, minutes: 60 }, enabled]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register a runner callback for repeat delivery suppression.
await test('reloads and lead-time changes do not repeat a delivered occurrence', () => {
  const receipt = rememberDelivery({}, { event, end }, end - 600_000);
  const restored = parseHistory(JSON.parse(JSON.stringify(receipt)) as unknown);
  return assert.deepEqual([
    Object.values(dueReminders([event], end - 300_000, enabled, restored)).length,
    Object.values(dueReminders([event], end - 60_000, { enabled: true, minutes: 60 }, restored)).length,
  ], [0, 0]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register a runner callback for schedule editing and deletion.
await test('deleted schedules disappear and rescheduled targets can notify again', () => {
  const changed: ScheduleEvent = { ...event, targetAt: new Date(end + 60_000).toISOString() };
  return assert.deepEqual([
    Object.values(dueReminders([], end - 60_000, enabled, { [event.id]: end })).length,
    Object.values(dueReminders([changed], end - 60_000, enabled, { [event.id]: end })).map(reminder => reminder.end),
  ], [0, [end + 60_000]]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register a runner callback for recurring reminder boundaries.
await test('short recurrences notify once for the next occurrence without replaying missed occurrences', () => {
  const recurring: ScheduleEvent = { ...event, repeatUnit: 'minute' };
  return assert.deepEqual([
    Object.values(dueReminders([recurring], end - 1, enabled, { [event.id]: end })).map(reminder => reminder.end),
    Object.values(dueReminders([recurring], end, enabled, { [event.id]: end })).map(reminder => reminder.end),
    Object.values(dueReminders([recurring], end + 3_600_000, enabled, { [event.id]: end })).map(reminder => reminder.end),
  ], [[], [end + 60_000], [end + 3_660_000]]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register a runner callback for daylight-saving recurrence correctness.
await test('daily reminders follow event time zones across daylight-saving changes', () => {
  const spring: ScheduleEvent = { ...event, targetAt: fromLocal('2026-03-07T09:00', 'America/New_York'), repeatUnit: 'day', timeZone: 'America/New_York' };
  const fall: ScheduleEvent = { ...spring, targetAt: fromLocal('2026-10-31T09:00', 'America/New_York') };
  return assert.deepEqual([
    Object.values(dueReminders([spring], Date.parse('2026-03-08T12:50:00Z'), enabled, {})).map(reminder => new Date(reminder.end).toISOString()),
    Object.values(dueReminders([fall], Date.parse('2026-11-01T13:50:00Z'), enabled, {})).map(reminder => new Date(reminder.end).toISOString()),
  ], [['2026-03-08T13:00:00.000Z'], ['2026-11-01T14:00:00.000Z']]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register a runner callback for anchored calendar recurrences.
await test('monthly reminders keep month-end anchoring', () => {
  const monthly: ScheduleEvent = { ...event, targetAt: '2026-01-31T10:00:00Z', repeatUnit: 'month' };
  return assert.deepEqual([
    Object.values(dueReminders([monthly], Date.parse('2026-02-28T09:50:00Z'), enabled, {})).map(reminder => new Date(reminder.end).toISOString()),
    Object.values(dueReminders([monthly], Date.parse('2026-03-31T09:50:00Z'), enabled, {})).map(reminder => new Date(reminder.end).toISOString()),
  ], [['2026-02-28T10:00:00.000Z'], ['2026-03-31T10:00:00.000Z']]);
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters, functional/no-return-void -- Register a runner callback for delivery receipt retention and validation.
await test('history discards malformed entries and expires old receipts', () => {
  return assert.deepEqual([
    parseHistory({ good: end, bad: 'text', infinite: Infinity }), parseHistory(null), parseHistory([end]),
    rememberDelivery({ past: end - 1000, future: end + 1000 }, { event, end: end + 5000 }, end),
  ], [{ good: end }, {}, {}, { future: end + 1000, [event.id]: end + 5000 }]);
});
