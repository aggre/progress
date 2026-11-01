import assert from 'node:assert/strict';
import { test } from 'node:test';
import { always } from 'ramda';
import { angleDelta, coast, MAX_SPIN_SPEED, releaseVelocity, validateRoulette, winningIndex } from '@little/shared/roulette';

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register pure validation assertions with the native test runner.
await test('roulette validation trims text and rejects malformed or unbounded choices', () => {
  return void [
    assert.deepEqual(validateRoulette({ title: ' Dinner ', options: [' Pasta ', 'カレー'] }), { title: 'Dinner', options: ['Pasta', 'カレー'], playMinutes: 30, afterTask: null }),
    assert.equal('error' in validateRoulette({ title: 'x'.repeat(80), options: Array.from({ length: 20 }, always('x'.repeat(60))) }), false),
    ...[
      {}, { title: ' ', options: ['a', 'b'] }, { title: 'x'.repeat(81), options: ['a', 'b'] },
      { title: 'Dinner', options: ['a'] }, { title: 'Dinner', options: ['a', ' '] },
      { title: 'Dinner', options: ['a', 1] }, { title: 'Dinner', options: 'a,b' },
      { title: 'Dinner', options: ['a', 'x'.repeat(61)] },
      { title: 'Dinner', options: Array.from({ length: 21 }, always('a')) },
      { title: 'Dinner', options: ['a', 'b'], familyId: 'forged' },
    ].map((input: Readonly<Record<string, unknown>>) => (assert.equal('error' in validateRoulette(input), true), true)),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register deterministic pointer/segment geometry assertions with the test runner.
await test('the fixed top pointer selects the visible segment in either direction after any number of turns', () => {
  return void [
    assert.equal(angleDelta(179, -179), 2), assert.equal(angleDelta(-179, 179), -2),
    Array.from({ length: 19 }, (_, i) => i + 2).every(count => Array.from({ length: count }, (_, index) => index).every(index => [-1080, 0, 1080].every(turns =>
      (assert.equal(winningIndex(-(index + 0.5) * 360 / count + turns, count), index), true)))),
    assert.equal(winningIndex(0, 4), 0), assert.equal(winningIndex(360, 4), 0),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register deterministic inertia assertions with the test runner.
await test('inertia slows smoothly, preserves direction, and is independent of animation frame rate', () => {
  const direct = coast(12, 900, 1);
  const frames = Array.from({ length: 120 }).reduce<Readonly<{ rotation: number; velocity: number }>>(state => coast(state.rotation, state.velocity, 1 / 120), { rotation: 12, velocity: 900 });
  return void [
    assert.ok(Math.abs(direct.rotation - frames.rotation) < 1e-9),
    assert.ok(Math.abs(direct.velocity - frames.velocity) < 1e-9),
    assert.ok(direct.velocity > 0 && direct.velocity < 900),
    assert.ok(coast(0, -900, 1).velocity < 0),
    assert.ok(coast(0, 900, 6).velocity < 8),
    assert.deepEqual(coast(12, 900, 0), { rotation: 12, velocity: 900 }),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register gesture timing assertions with the test runner.
await test('release speed follows a slow or fast flick and holding the wheel removes stale momentum', () => {
  return void [
    assert.equal(releaseVelocity([{ angle: 0, time: 0 }, { angle: 18, time: 90 }], 90), 200),
    assert.equal(releaseVelocity([{ angle: 0, time: 0 }, { angle: 18, time: 90 }], 140), 200),
    assert.equal(releaseVelocity([{ angle: 0, time: 0 }, { angle: 90, time: 90 }], 90), 1000),
    assert.equal(releaseVelocity([{ angle: 0, time: 0 }, { angle: -90, time: 90 }], 90), -1000),
    assert.equal(releaseVelocity([{ angle: 0, time: 0 }, { angle: 90, time: 10 }], 10), MAX_SPIN_SPEED),
    assert.equal(releaseVelocity([{ angle: 0, time: 0 }, { angle: 90, time: 10 }], 300), 0),
    assert.equal(releaseVelocity([{ angle: 0, time: 10 }, { angle: 90, time: 10 }], 10), 0),
    assert.equal(releaseVelocity([], 10), 0),
  ];
});
