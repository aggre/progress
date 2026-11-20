import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildQuickTimer,
  extendQuickTimer,
  isQuickTimer,
  MAX_TIMER_MINUTES,
  timerDurationLabel,
  timerDurations,
  timerPresets,
  timerTotalMinutes,
} from '@little/shared/timer';

const nowMs = Date.parse('2026-11-20T09:00:00.000Z');

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register pure timer preset and duration assertions with the native test runner.
await test('timer presets and duration labels cover common family timer steps', () => {
  return void [
    assert.deepEqual(Object.values(timerDurations), [5, 10, 15, 30, 45, 60]),
    assert.equal(Object.values(timerPresets).length, 7),
    assert.equal(timerPresets[0]?.title, 'Game time'),
    assert.equal(timerPresets[0]?.emoji, '🎮'),
    assert.equal(timerDurationLabel(5), '5 min'),
    assert.equal(timerDurationLabel(30), '30 min'),
    assert.equal(timerDurationLabel(60), '1 hr'),
    assert.equal(timerDurationLabel(90), '1 hr 30 min'),
    assert.equal(timerDurationLabel(120), '2 hr'),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register quick-timer validation and detection assertions with the native test runner.
await test('buildQuickTimer creates a one-time family schedule and rejects invalid durations or fields', () => {
  const created = buildQuickTimer({ title: ' Game time ', emoji: '🎮', color: '#F4B8B1', minutes: 30, timeZone: 'Asia/Tokyo' }, nowMs);
  return void [
    assert.equal('error' in created, false),
    assert.deepEqual(created, {
      title: 'Game time',
      emoji: '🎮',
      color: '#f4b8b1',
      startAt: '2026-11-20T09:00:00Z',
      targetAt: '2026-11-20T09:30:00Z',
      repeatUnit: 'none',
      repeatEvery: 1,
      timeZone: 'Asia/Tokyo',
    }),
    assert.equal('error' in created ? false : isQuickTimer(created), true),
    assert.equal('error' in created ? 0 : timerTotalMinutes(created), 30),
    ...[
      { title: '', minutes: 30 },
      { title: 'Game time', minutes: 0 },
      { title: 'Game time', minutes: MAX_TIMER_MINUTES + 1 },
      { title: 'Game time', minutes: 7.5 },
      { title: 'Game time', minutes: '30' },
      { title: 'Game time', minutes: 30, extra: true },
    ].map((input: Readonly<Record<string, unknown>>) => (assert.equal('error' in buildQuickTimer(input, nowMs), true), true)),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register quick-timer classification assertions against long countdowns, recurring schedules, and roulette activities.
await test('isQuickTimer distinguishes short one-time timers from multi-day countdowns, repeating events, and roulette plans', () => {
  const base = buildQuickTimer({ title: 'Reading', emoji: '📖', color: '#f8daae', minutes: 15 }, nowMs);
  return void (
    !('error' in base) && [
      assert.equal(isQuickTimer(base), true),
      assert.equal(isQuickTimer({ ...base, repeatUnit: 'day' }), false),
      assert.equal(isQuickTimer({ ...base, targetAt: new Date(nowMs + 86_400_000 * 3).toISOString() }), false),
      assert.equal(isQuickTimer({ ...base, activity: { playMinutes: 15, afterTask: null } }), false),
    ]
  );
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register pure timer extension assertions with the native test runner.
await test('extendQuickTimer adds whole minutes up to the maximum timer bound', () => {
  const initial = buildQuickTimer({ title: 'Game time', emoji: '🎮', color: '#f4b8b1', minutes: 30 }, nowMs);
  return void (
    !('error' in initial) && [
      assert.deepEqual(extendQuickTimer(initial, 5, nowMs + 10 * 60_000), {
        ...initial,
        targetAt: '2026-11-20T09:35:00Z',
      }),
      assert.deepEqual(extendQuickTimer(initial, 5, nowMs + 40 * 60_000), {
        ...initial,
        targetAt: '2026-11-20T09:45:00Z',
      }),
      assert.equal('error' in extendQuickTimer(initial, 0, nowMs), true),
      assert.equal('error' in extendQuickTimer(initial, 61, nowMs), true),
      assert.equal('error' in extendQuickTimer(initial, 60, nowMs + 200 * 60_000), true),
    ]
  );
});
