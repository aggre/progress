import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityMinutes, activityPhase, validateActivityPlan, validateRouletteStart } from '@little/shared/activity';

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register plan validation assertions with the native test runner.
await test('activity plans accept one optional task and reject invalid names or durations', () => {
  return void [
    assert.deepEqual(validateActivityPlan({}), { playMinutes: 30, afterTask: null }),
    assert.deepEqual(validateActivityPlan({ playMinutes: 240, afterTask: { title: ' Clean up ', minutes: 60 } }), { playMinutes: 240, afterTask: { title: 'Clean up', minutes: 60 } }),
    ...[
      { playMinutes: 0 }, { playMinutes: 241 }, { playMinutes: 1.5 }, { playMinutes: '30' }, { playMinutes: NaN },
      { afterTask: [] }, { afterTask: 'clean up' }, { afterTask: { title: '', minutes: 5 } },
      { afterTask: { title: 'x'.repeat(61), minutes: 5 } }, { afterTask: { title: 'Clean up', minutes: 0 } },
      { afterTask: { title: 'Clean up', minutes: 61 } }, { afterTask: { title: 'Clean up', minutes: 2.5 } },
      { afterTask: { title: 'Clean up', minutes: '5' } }, { afterTask: { title: 'Clean up', minutes: 5, next: {} } },
    ].map((input: Readonly<Record<string, unknown>>) => (assert.equal('error' in validateActivityPlan(input), true), true)),
  ];
});

const startAt = '2026-11-01T12:00:00Z', start = Date.parse(startAt);
const plan = { playMinutes: 30, afterTask: { title: 'Clean up', minutes: 5 } } as const;

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register absolute-time stage-boundary assertions with the test runner.
await test('one activity moves from play to its task at the exact boundary and completes after both steps', () => {
  return void [
    assert.equal(activityMinutes(plan), 35),
    assert.deepEqual(activityPhase('Drawing', startAt, plan, start), { title: 'Drawing', stage: 'play', progress: 0, remaining: 30 * 60000 }),
    assert.equal(activityPhase('Drawing', startAt, plan, start + 30 * 60000 - 1).stage, 'play'),
    assert.deepEqual(activityPhase('Drawing', startAt, plan, start + 30 * 60000), { title: 'Clean up', stage: 'after', progress: 0, remaining: 5 * 60000 }),
    assert.deepEqual(activityPhase('Drawing', startAt, plan, start + 32.5 * 60000), { title: 'Clean up', stage: 'after', progress: 50, remaining: 2.5 * 60000 }),
    assert.deepEqual(activityPhase('Drawing', startAt, plan, start + 35 * 60000), { title: 'Clean up', stage: 'complete', progress: 100, remaining: 0 }),
    assert.equal(activityPhase('Drawing', startAt, plan, start + 86400000).stage, 'complete'),
    assert.equal(activityPhase('Drawing', startAt, plan, start - 1000).progress, 0),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register optional-task behavior assertions with the test runner.
await test('a play-only activity completes without inventing a second task', () => {
  const playOnly = { playMinutes: 10, afterTask: null } as const;
  return void [
    assert.equal(activityMinutes(playOnly), 10),
    assert.deepEqual(activityPhase('LEGO', startAt, playOnly, start + 5 * 60000), { title: 'LEGO', stage: 'play', progress: 50, remaining: 5 * 60000 }),
    assert.deepEqual(activityPhase('LEGO', startAt, playOnly, start + 10 * 60000), { title: 'LEGO', stage: 'complete', progress: 100, remaining: 0 }),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register start-request bounds and ownership-forgery assertions with the test runner.
await test('roulette starts require a bounded choice, stable request ID, and displayed version', () => {
  const valid = { choiceIndex: 0, requestId: 'abcde123-1234-1234-1234-123456789abc', version: startAt } as const;
  return void [
    assert.deepEqual(validateRouletteStart(valid), valid),
    ...[{ ...valid, choiceIndex: -1 }, { ...valid, choiceIndex: 20 }, { ...valid, choiceIndex: 0.5 },
      { ...valid, requestId: '' }, { ...valid, version: '' }, { ...valid, ownerId: 'someone-else' },
    ].map((input: Readonly<Record<string, unknown>>) => (assert.equal('error' in validateRouletteStart(input), true), true)),
  ];
});
