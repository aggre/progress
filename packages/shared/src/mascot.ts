import { clamp } from 'ramda';
import { Temporal } from '@js-temporal/polyfill';

export type SpringFeel = 'jelly' | 'plush' | 'calm';

export type MascotMood = 'fresh' | 'active' | 'cozy' | 'sleepy' | 'napping';

export interface MascotStageInfo {
  readonly stage: 1 | 2 | 3 | 4;
  readonly minXp: number;
  readonly nextXp: number;
  readonly emoji: string;
  readonly name: string;
}

export interface MascotProfile {
  readonly xp: number;
  readonly streak: number;
  readonly lastActiveDay: string | null;
  readonly dayKey: string;
  readonly effortPoints: number;
  readonly restPoints: number;
  readonly napping: boolean;
  readonly springFeel: SpringFeel;
  readonly timeZone: string;
}

export interface MascotGoal {
  readonly id: string;
  readonly title: string;
  readonly emoji: string;
  readonly color: string;
  readonly xpReward: number;
  readonly effortDelta: number;
  readonly completedToday: boolean;
}

export interface MascotGoalInput {
  readonly title: string;
  readonly emoji: string;
  readonly color: string;
  readonly xpReward: number;
  readonly effortDelta: number;
}

export interface MascotStatePayload {
  readonly profile: MascotProfile;
  readonly goals: Readonly<ArrayLike<MascotGoal>>;
  readonly claimedEventIds: Readonly<ArrayLike<string>>;
}

export interface MascotFatigueReport {
  readonly fatigue: number;
  readonly energy: number;
  readonly circadian: number;
  readonly effort: number;
  readonly rest: number;
  readonly mood: MascotMood;
  readonly headline: string;
}

export interface SpringState {
  readonly x: number;
  readonly v: number;
  readonly target: number;
}

export interface SpringPreset {
  readonly k: number;
  readonly d: number;
  readonly petalK: number;
  readonly petalD: number;
  readonly label: string;
  readonly description: string;
}

export const MAX_EFFORT_POINTS = 80;
export const MAX_REST_POINTS = 65;
export const MAX_MASCOT_GOALS = 12;

export const SPRING_FEELS: Readonly<Record<SpringFeel, SpringPreset>> = {
  jelly: {
    k: 190,
    d: 10,
    petalK: 130,
    petalD: 7.5,
    label: 'Bouncy Jelly',
    description: 'Extra bouncy squash & playful petal whip',
  },
  plush: {
    k: 220,
    d: 15,
    petalK: 155,
    petalD: 11,
    label: 'Plush',
    description: 'Juicy petal lag & volume-preserving squish',
  },
  calm: {
    k: 140,
    d: 18,
    petalK: 105,
    petalD: 14,
    label: 'Gentle',
    description: 'Soft cushioned motion & gentle breathing',
  },
};

export const MASCOT_STAGES: Readonly<ArrayLike<MascotStageInfo>> = [
  { stage: 1, minXp: 0, nextXp: 100, emoji: '🌱', name: 'Seed Sprout' },
  { stage: 2, minXp: 100, nextXp: 250, emoji: '🌷', name: 'Little Bud' },
  { stage: 3, minXp: 250, nextXp: 500, emoji: '🌸', name: 'Blooming Petal' },
  { stage: 4, minXp: 500, nextXp: 500, emoji: '👑', name: 'Radiant Star' },
];

export const STARTER_MASCOT_GOALS: Readonly<ArrayLike<MascotGoalInput>> = [
  { title: 'Read 15 min', emoji: '📖', color: '#f8daae', xpReward: 30, effortDelta: 12 },
  { title: 'Math puzzles', emoji: '➕', color: '#d7e7ff', xpReward: 40, effortDelta: 16 },
  { title: 'Tidy up toys', emoji: '🧹', color: '#d2e7b9', xpReward: 25, effortDelta: 10 },
  { title: 'Drink water', emoji: '💧', color: '#dff2ff', xpReward: 15, effortDelta: -14 },
];

export function mascotStage(xp: number): MascotStageInfo {
  const safeXp = Math.max(0, xp);
  return Array.from(MASCOT_STAGES).reverse().find(stage => safeXp >= stage.minXp) ?? MASCOT_STAGES[0];
}

export function mascotXpProgress(xp: number): Readonly<{
  stage: MascotStageInfo;
  current: number;
  target: number;
  percent: number;
  isMax: boolean;
}> {
  const safeXp = Math.max(0, Math.floor(xp));
  const stage = mascotStage(safeXp);
  const isMax = stage.stage === 4;
  const span = Math.max(1, stage.nextXp - stage.minXp);
  const percent = isMax ? 100 : clamp(4, 100, Math.round(((safeXp - stage.minXp) / span) * 100));
  return { stage, current: safeXp, target: stage.nextXp, percent, isMax };
}

export function safeTimeZone(value: unknown, fallback = 'Asia/Tokyo'): string {
  // eslint-disable-next-line functional/no-try-statements -- Validate untrusted IANA timezone identifiers safely without throwing.
  try {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80
      ? Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value.trim()).timeZoneId
      : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Day rolls over at 04:00 local time so late-evening routines do not abruptly
 * reset before bedtime.
 */
export function localDayKey(nowMs: number, timeZone: string): string {
  const zone = safeTimeZone(timeZone);
  return Temporal.Instant.fromEpochMilliseconds(nowMs)
    .toZonedDateTimeISO(zone)
    .subtract({ hours: 4 })
    .toPlainDate()
    .toString();
}

export function previousDayKey(dayKey: string): string {
  return Temporal.PlainDate.from(dayKey).subtract({ days: 1 }).toString();
}

export function localFractionalHour(nowMs: number, timeZone: string): number {
  const zone = safeTimeZone(timeZone);
  const { hour, minute }: Readonly<{ hour: number; minute: number }> =
    Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(zone);
  return hour + minute / 60;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function circadianFatigue(hour: number): number {
  const h = Number.isFinite(hour) ? hour : 12;
  return h < 4 ? 74
    : h <= 9 ? clamp(4, 15, (h - 6) * 2.5 + 4)
    : h <= 15 ? lerp(12, 26, (h - 9) / 6)
    : h <= 19 ? lerp(26, 48, (h - 15) / 4)
    : lerp(48, 72, clamp(0, 1, (h - 19) / 3.5));
}

export function computeMascotFatigue(
  profile: Readonly<Pick<MascotProfile, 'effortPoints' | 'restPoints' | 'napping' | 'timeZone'>>,
  nowMs: number,
  overrideHour?: number,
): MascotFatigueReport {
  const hour = overrideHour !== undefined ? overrideHour : localFractionalHour(nowMs, profile.timeZone);
  const circadian = Math.round(circadianFatigue(hour));
  const effort = clamp(0, MAX_EFFORT_POINTS, Math.round(profile.effortPoints));
  const rest = clamp(0, MAX_REST_POINTS, Math.round(profile.restPoints));
  const fatigue = clamp(0, 100, circadian + effort - rest);
  const energy = 100 - fatigue;
  const mood: MascotMood = profile.napping ? 'napping'
    : fatigue >= 78 ? 'sleepy'
    : fatigue >= 52 ? 'cozy'
    : fatigue >= 28 ? 'active'
    : 'fresh';
  const headline = mood === 'napping' ? 'Petal is taking a cozy nap...'
    : mood === 'sleepy' ? 'Whew, big day! Time to wind down'
    : mood === 'cozy' ? 'Getting a little tired — great effort!'
    : mood === 'active' ? 'Warming up & going strong!'
    : 'Petal is bright & bouncy!';
  return { fatigue, energy, circadian, effort, rest, mood, headline };
}

export function stepSpringValue(spring: SpringState, k: number, d: number, dt: number): SpringState {
  const force = (spring.target - spring.x) * k;
  const damp = spring.v * d;
  const v = spring.v + (force - damp) * dt;
  const x = spring.x + v * dt;
  return { x, v, target: spring.target };
}

export function isSpringFeel(value: unknown): value is SpringFeel {
  return value === 'jelly' || value === 'plush' || value === 'calm';
}

export function validateGoalInput(raw: unknown): MascotGoalInput | Readonly<{ error: string }> {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Readonly<Record<string, unknown>> : null;
  const allowedKeys: Readonly<ArrayLike<string>> = ['title', 'emoji', 'color', 'xpReward', 'effortDelta'];
  return !obj || Object.keys(obj).some(key => !Array.from(allowedKeys).includes(key))
    ? { error: 'Provide only a goal title, emoji, color, XP reward, and effort.' }
    : typeof obj.title !== 'string' || !obj.title.trim() || obj.title.trim().length > 60
      ? { error: 'Use a goal name between 1 and 60 characters.' }
    : typeof obj.emoji !== 'string' || !obj.emoji.trim() || [...obj.emoji.trim()].length > 16
      ? { error: 'Choose an emoji for this goal.' }
    : typeof obj.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(obj.color)
      ? { error: 'Choose a valid six-digit color.' }
    : typeof obj.xpReward !== 'number' || !Number.isInteger(obj.xpReward) || obj.xpReward < 5 || obj.xpReward > 100
      ? { error: 'Choose an XP reward between 5 and 100.' }
    : typeof obj.effortDelta !== 'number' || !Number.isInteger(obj.effortDelta) || obj.effortDelta < -40 || obj.effortDelta > 40
      ? { error: 'Choose an effort value between -40 and 40.' }
    : {
      title: obj.title.trim(),
      emoji: obj.emoji.trim(),
      color: obj.color.toLowerCase(),
      xpReward: obj.xpReward,
      effortDelta: obj.effortDelta,
    };
}

export function rewardForCompletedSchedule(title: string, durationMinutes: number): Readonly<{ xp: number; effortDelta: number }> {
  const safeMinutes = clamp(1, 240, Math.round(durationMinutes));
  const lower = title.toLowerCase();
  const isRestorative = /\b(bath|rest|nap|break|sleep|relax|water|stretch)\b/.test(lower);
  const xp = clamp(15, 60, Math.round(safeMinutes * 1.4) + 10);
  const effortDelta = isRestorative
    ? -clamp(10, 30, Math.round(safeMinutes * 0.8) + 8)
    : clamp(6, 28, Math.round(safeMinutes * 0.45) + 5);
  return { xp, effortDelta };
}
