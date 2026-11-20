import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  circadianFatigue,
  computeMascotFatigue,
  localDayKey,
  mascotStage,
  mascotXpProgress,
  previousDayKey,
  rewardForCompletedSchedule,
  safeTimeZone,
  stepSpringValue,
  validateGoalInput,
} from '@little/shared/mascot';

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register pure growth stage progression assertions.
await test('mascotStage and mascotXpProgress evolve across all four growth stages', () => {
  return void [
    assert.equal(mascotStage(0).stage, 1),
    assert.equal(mascotStage(99).stage, 1),
    assert.equal(mascotStage(100).stage, 2),
    assert.equal(mascotStage(249).stage, 2),
    assert.equal(mascotStage(250).stage, 3),
    assert.equal(mascotStage(499).stage, 3),
    assert.equal(mascotStage(500).stage, 4),
    assert.deepEqual(mascotXpProgress(175), {
      stage: { stage: 2, minXp: 100, nextXp: 250, emoji: '🌷', name: 'Little Bud' },
      current: 175,
      target: 250,
      percent: 50,
      isMax: false,
    }),
    assert.equal(mascotXpProgress(620).isMax, true),
    assert.equal(mascotXpProgress(620).percent, 100),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register circadian rhythm, effort load, and rest recovery assertions.
await test('computeMascotFatigue reflects time of day, accumulated effort, rest recovery, and nap mood', () => {
  const morning = computeMascotFatigue({ effortPoints: 0, restPoints: 0, napping: false, timeZone: 'Asia/Tokyo' }, 0, 8.5);
  const busyAfternoon = computeMascotFatigue({ effortPoints: 36, restPoints: 4, napping: false, timeZone: 'Asia/Tokyo' }, 0, 16.5);
  const lateNight = computeMascotFatigue({ effortPoints: 50, restPoints: 0, napping: false, timeZone: 'Asia/Tokyo' }, 0, 21.5);
  const napping = computeMascotFatigue({ effortPoints: 50, restPoints: 0, napping: true, timeZone: 'Asia/Tokyo' }, 0, 21.5);

  return void [
    assert.ok(circadianFatigue(8.5) < circadianFatigue(16.5)),
    assert.ok(circadianFatigue(16.5) < circadianFatigue(21.5)),
    assert.equal(morning.mood, 'fresh'),
    assert.equal(morning.fatigue + morning.energy, 100),
    assert.ok(busyAfternoon.fatigue > morning.fatigue),
    assert.equal(busyAfternoon.mood, 'cozy'),
    assert.equal(lateNight.mood, 'sleepy'),
    assert.equal(napping.mood, 'napping'),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register 04:00 local day rollover and timezone fallback assertions.
await test('localDayKey rolls over at 04:00 local time and safeTimeZone rejects invalid zones', () => {
  const beforeFourAm = Date.parse('2026-11-20T18:30:00Z'); // 03:30 JST on Nov 21
  const afterFourAm = Date.parse('2026-11-20T19:05:00Z'); // 04:05 JST on Nov 21
  return void [
    assert.equal(localDayKey(beforeFourAm, 'Asia/Tokyo'), '2026-11-20'),
    assert.equal(localDayKey(afterFourAm, 'Asia/Tokyo'), '2026-11-21'),
    assert.equal(previousDayKey('2026-11-21'), '2026-11-20'),
    assert.equal(safeTimeZone('Invalid/Zone', 'UTC'), 'UTC'),
    assert.equal(safeTimeZone('America/New_York', 'UTC'), 'America/New_York'),
  ];
});

// eslint-disable-next-line functional/no-expression-statements, functional/functional-parameters -- Register spring integration and validation assertions.
await test('stepSpringValue converges toward target and goal/reward helpers validate bounds', () => {
  const stepped = Array.from({ length: 120 }).reduce(
    sp => stepSpringValue(sp, 220, 15, 1 / 60),
    { x: 0, v: 0, target: 10 },
  );
  const validGoal = validateGoalInput({ title: ' Practice piano ', emoji: '🎹', color: '#F8DAAE', xpReward: 30, effortDelta: 12 });
  return void [
    assert.ok(Math.abs(stepped.x - 10) < 0.05),
    assert.deepEqual(validGoal, { title: 'Practice piano', emoji: '🎹', color: '#f8daae', xpReward: 30, effortDelta: 12 }),
    assert.equal('error' in validateGoalInput({ title: '', emoji: '🎹', color: '#f8daae', xpReward: 30, effortDelta: 12 }), true),
    assert.equal('error' in validateGoalInput({ title: 'Piano', emoji: '🎹', color: 'red', xpReward: 30, effortDelta: 12 }), true),
    assert.equal('error' in validateGoalInput({ title: 'Piano', emoji: '🎹', color: '#f8daae', xpReward: 2, effortDelta: 12 }), true),
    assert.equal('error' in validateGoalInput({ title: 'Piano', emoji: '🎹', color: '#f8daae', xpReward: 30, effortDelta: 12, extra: true }), true),
    assert.ok(rewardForCompletedSchedule('Homework', 20).effortDelta > 0),
    assert.ok(rewardForCompletedSchedule('Bath & ready', 15).effortDelta < 0),
  ];
});
