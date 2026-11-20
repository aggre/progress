import { Hono } from 'hono';
import { always, clamp } from 'ramda';
import type { User } from '@little/shared/api';
import {
  isSpringFeel,
  localDayKey,
  MAX_EFFORT_POINTS,
  MAX_MASCOT_GOALS,
  MAX_REST_POINTS,
  previousDayKey,
  rewardForCompletedSchedule,
  safeTimeZone,
  STARTER_MASCOT_GOALS,
  validateGoalInput,
  type MascotGoal,
  type MascotProfile,
  type MascotStatePayload,
  type SpringFeel,
} from '@little/shared/mascot';
import { jsonObject, requireAuth, throttle } from './security';
import type { AppEnv } from './types';

type WriteResult = Readonly<{ meta: Readonly<{ changes: number }> }>;

interface ProfileRow {
  readonly user_id: string;
  readonly xp: number;
  readonly streak: number;
  readonly last_active_day: string | null;
  readonly day_key: string;
  readonly effort_points: number;
  readonly rest_points: number;
  readonly napping: number;
  readonly spring_feel: SpringFeel;
  readonly time_zone: string;
  readonly updated_at: string;
}

interface GoalRow {
  readonly id: string;
  readonly user_id: string;
  readonly title: string;
  readonly emoji: string;
  readonly color: string;
  readonly xp_reward: number;
  readonly effort_delta: number;
  readonly completed_day: string | null;
  readonly sort_order: number;
  readonly created_at: string;
}

interface ClaimRow {
  readonly event_id: string;
}

interface ScheduleClaimSource {
  readonly id: string;
  readonly title: string;
  readonly start_at: string;
  readonly target_at: string;
  readonly repeat_unit: string;
}

function mapProfile(row: ProfileRow): MascotProfile {
  return {
    xp: row.xp,
    streak: row.streak,
    lastActiveDay: row.last_active_day,
    dayKey: row.day_key,
    effortPoints: row.effort_points,
    restPoints: row.rest_points,
    napping: row.napping === 1,
    springFeel: row.spring_feel,
    timeZone: row.time_zone,
  };
}

function mapGoal(row: GoalRow, todayKey: string): MascotGoal {
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    color: row.color,
    xpReward: row.xp_reward,
    effortDelta: row.effort_delta,
    completedToday: row.completed_day === todayKey,
  };
}

function validationFailure(error: unknown): Readonly<{ error: string }> {
  return { error: error instanceof Error ? error.message : 'Invalid request.' };
}

function nextStreakValue(
  currentStreak: number,
  lastActiveDay: string | null,
  todayKey: string,
): number {
  const yesterdayKey = previousDayKey(todayKey);
  return lastActiveDay === todayKey ? currentStreak
    : lastActiveDay === yesterdayKey ? currentStreak + 1
    : 1;
}

function rolloverStreakValue(
  currentStreak: number,
  lastActiveDay: string | null,
  todayKey: string,
): number {
  const yesterdayKey = previousDayKey(todayKey);
  return lastActiveDay === todayKey || lastActiveDay === yesterdayKey ? currentStreak : 0;
}

// eslint-disable-next-line functional/prefer-immutable-types -- Ensure a per-user mascot profile and starter goals exist in D1, rolling daily fatigue cleanly at the local day boundary.
async function ensureProfile(db: D1Database, userId: string, requestedTz: unknown): Promise<ProfileRow> {
  const nowMs = Date.now();
  const stamp = new Date(nowMs).toISOString();
  const initialZone = safeTimeZone(requestedTz, 'Asia/Tokyo');
  const existing = await db.prepare('SELECT * FROM mascot_profiles WHERE user_id = ?')
    .bind(userId).first<ProfileRow>();
  const zone = safeTimeZone(requestedTz, existing?.time_zone ?? initialZone);
  const todayKey = localDayKey(nowMs, zone);

  // eslint-disable-next-line functional/no-conditional-statements -- Create the user's initial mascot profile and starter daily goals once in D1.
  if (!existing) {
    // eslint-disable-next-line functional/prefer-immutable-types -- Cloudflare D1PreparedStatement instances are constructed solely for atomic batch persistence.
    const starterStatements = Array.from(STARTER_MASCOT_GOALS).map((goal, index) =>
      db.prepare(`
        INSERT INTO mascot_goals (id, user_id, title, emoji, color, xp_reward, effort_delta, completed_day, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).bind(crypto.randomUUID(), userId, goal.title, goal.emoji, goal.color, goal.xpReward, goal.effortDelta, index, stamp));
    // eslint-disable-next-line functional/no-expression-statements -- Batch initial profile and starter goal creation atomically in D1.
    await db.batch([
      db.prepare(`
        INSERT OR IGNORE INTO mascot_profiles (user_id, xp, streak, last_active_day, day_key, effort_points, rest_points, napping, spring_feel, time_zone, updated_at)
        VALUES (?, 0, 0, NULL, ?, 0, 0, 0, 'plush', ?, ?)
      `).bind(userId, todayKey, zone, stamp),
      ...starterStatements,
    ]);
    const created = await db.prepare('SELECT * FROM mascot_profiles WHERE user_id = ?')
      .bind(userId).first<ProfileRow>();
    return created ?? {
      user_id: userId, xp: 0, streak: 0, last_active_day: null, day_key: todayKey,
      effort_points: 0, rest_points: 0, napping: 0, spring_feel: 'plush', time_zone: zone, updated_at: stamp,
    };
  }

  // eslint-disable-next-line functional/no-conditional-statements -- Reset daily fatigue and sleep state when crossing into a new local day.
  if (existing.day_key !== todayKey) {
    const rolledStreak = rolloverStreakValue(existing.streak, existing.last_active_day, todayKey);
    // eslint-disable-next-line functional/no-expression-statements -- Persist the daily rollover in D1 before reading goals.
    await db.prepare(`
      UPDATE mascot_profiles
      SET day_key = ?, effort_points = 0, rest_points = 0, napping = 0, streak = ?, time_zone = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(todayKey, rolledStreak, zone, stamp, userId).run();
    return {
      ...existing,
      day_key: todayKey,
      effort_points: 0,
      rest_points: 0,
      napping: 0,
      streak: rolledStreak,
      time_zone: zone,
      updated_at: stamp,
    };
  }

  // eslint-disable-next-line functional/no-conditional-statements -- Keep stored timezone synchronized with the user's current browser timezone.
  if (existing.time_zone !== zone) {
    // eslint-disable-next-line functional/no-expression-statements -- Persist updated timezone preference in D1.
    await db.prepare('UPDATE mascot_profiles SET time_zone = ?, updated_at = ? WHERE user_id = ?')
      .bind(zone, stamp, userId).run();
    return { ...existing, time_zone: zone, updated_at: stamp };
  }

  return existing;
}

// eslint-disable-next-line functional/prefer-immutable-types -- Load the user's full mascot state from D1.
async function loadState(db: D1Database, userId: string, requestedTz: unknown): Promise<MascotStatePayload> {
  const profileRow = await ensureProfile(db, userId, requestedTz);
  return {
    profile: mapProfile(profileRow),
    goals: (await db.prepare(`
      SELECT * FROM mascot_goals WHERE user_id = ? ORDER BY sort_order, created_at, id
    `).bind(userId).all<GoalRow>()).results.map(row => mapGoal(row, profileRow.day_key)),
    claimedEventIds: (await db.prepare(`
      SELECT event_id FROM mascot_claimed_events WHERE user_id = ? ORDER BY claimed_at DESC LIMIT 200
    `).bind(userId).all<ClaimRow>()).results.map(row => row.event_id),
  };
}

// eslint-disable-next-line functional/prefer-immutable-types -- Retain the native Hono router instance to register mascot endpoints.
export const mascot = new Hono<AppEnv>();
// eslint-disable-next-line functional/no-expression-statements -- Require an authenticated session on all mascot endpoints.
mascot.use('*', requireAuth);

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register mascot state read endpoint.
mascot.get('/', async c => {
  const user: Readonly<User> = c.get('identity').user;
  return c.json(await loadState(c.env.DB, user.id, c.req.query('tz')));
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register custom daily goal creation endpoint.
mascot.post('/goals', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'mascot-write', 60, 60, user.id);
  const input = allowed ? await jsonObject(c).then(validateGoalInput).catch(validationFailure)
    : { error: 'Please slow down.' } as const;
  // eslint-disable-next-line functional/no-conditional-statements -- Return validation or throttle failure before writing to D1.
  if (!allowed || 'error' in input) return c.json(input, allowed ? 400 : 429);

  const profile = await ensureProfile(c.env.DB, user.id, c.req.query('tz'));
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  const result: WriteResult = await c.env.DB.prepare(`
    INSERT INTO mascot_goals (id, user_id, title, emoji, color, xp_reward, effort_delta, completed_day, sort_order, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, NULL, COALESCE((SELECT MAX(sort_order) + 1 FROM mascot_goals WHERE user_id = ?), 0), ?
    WHERE (SELECT COUNT(*) FROM mascot_goals WHERE user_id = ?) < ?
  `).bind(id, user.id, input.title, input.emoji, input.color, input.xpReward, input.effortDelta, user.id, stamp, user.id, MAX_MASCOT_GOALS).run();

  return !result.meta.changes
    ? c.json({ error: `You can keep up to ${MAX_MASCOT_GOALS} daily goals.` }, 409)
    : c.json({
      goal: {
        id,
        title: input.title,
        emoji: input.emoji,
        color: input.color,
        xpReward: input.xpReward,
        effortDelta: input.effortDelta,
        completedToday: false,
      } satisfies MascotGoal,
      dayKey: profile.day_key,
    }, 201);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register daily goal deletion endpoint.
mascot.delete('/goals/:id', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'mascot-write', 60, 60, user.id);
  const result: WriteResult | null = allowed
    ? await c.env.DB.prepare('DELETE FROM mascot_goals WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).run()
    : null;
  return !allowed ? c.json({ error: 'Please slow down.' }, 429)
    : result?.meta.changes ? c.json({ ok: true }) : c.json({ error: 'This goal no longer exists.' }, 404);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Toggle a daily goal completion and update XP, streak, and daily fatigue/recovery in D1.
mascot.post('/goals/:id/toggle', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'mascot-write', 90, 60, user.id);
  // eslint-disable-next-line functional/no-conditional-statements -- Reject throttled requests before touching D1.
  if (!allowed) return c.json({ error: 'Please slow down.' }, 429);

  const body = await jsonObject(c).catch(always<Readonly<Record<string, unknown>>>({}));
  const profile = await ensureProfile(c.env.DB, user.id, body.tz);
  const goal = await c.env.DB.prepare('SELECT * FROM mascot_goals WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).first<GoalRow>();
  // eslint-disable-next-line functional/no-conditional-statements -- Return 404 when the requested goal does not belong to this user.
  if (!goal) return c.json({ error: 'This goal no longer exists.' }, 404);

  const todayKey = profile.day_key;
  const markingDone = goal.completed_day !== todayKey;
  const stamp = new Date().toISOString();

  const updatedGoal: WriteResult = await c.env.DB.prepare(`
    UPDATE mascot_goals
    SET completed_day = ?
    WHERE id = ? AND user_id = ? AND COALESCE(completed_day, '') != ?
  `).bind(markingDone ? todayKey : null, goal.id, user.id, markingDone ? todayKey : '').run();

  // eslint-disable-next-line functional/no-conditional-statements -- Only adjust XP and effort if the toggle actually transitioned state.
  if (updatedGoal.meta.changes) {
    const nextXp = markingDone ? profile.xp + goal.xp_reward : Math.max(0, profile.xp - goal.xp_reward);
    const nextEffort = goal.effort_delta >= 0
      ? clamp(0, MAX_EFFORT_POINTS, profile.effort_points + (markingDone ? goal.effort_delta : -goal.effort_delta))
      : profile.effort_points;
    const nextRest = goal.effort_delta < 0
      ? clamp(0, MAX_REST_POINTS, profile.rest_points + (markingDone ? Math.abs(goal.effort_delta) : -Math.abs(goal.effort_delta)))
      : profile.rest_points;
    const nextStreak = markingDone
      ? nextStreakValue(profile.streak, profile.last_active_day, todayKey)
      : profile.streak;
    const nextLastActive = markingDone ? todayKey : profile.last_active_day;
    const nextNapping = markingDone ? 0 : profile.napping;

    // eslint-disable-next-line functional/no-expression-statements -- Persist updated mascot growth and fatigue metrics in D1.
    await c.env.DB.prepare(`
      UPDATE mascot_profiles
      SET xp = ?, effort_points = ?, rest_points = ?, streak = ?, last_active_day = ?, napping = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(nextXp, nextEffort, nextRest, nextStreak, nextLastActive, nextNapping, stamp, user.id).run();
  }

  return c.json(await loadState(c.env.DB, user.id, profile.time_zone));
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Record a restful breather for the child's mascot.
mascot.post('/breather', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'mascot-write', 60, 60, user.id);
  // eslint-disable-next-line functional/no-conditional-statements -- Reject throttled breather updates.
  if (!allowed) return c.json({ error: 'Please slow down.' }, 429);

  const body = await jsonObject(c).catch(always<Readonly<Record<string, unknown>>>({}));
  const profile = await ensureProfile(c.env.DB, user.id, body.tz);
  const nextRest = clamp(0, MAX_REST_POINTS, profile.rest_points + 20);
  // eslint-disable-next-line functional/no-expression-statements -- Persist breather energy recovery in D1.
  await c.env.DB.prepare('UPDATE mascot_profiles SET rest_points = ?, napping = 0, updated_at = ? WHERE user_id = ?')
    .bind(nextRest, new Date().toISOString(), user.id).run();
  return c.json(await loadState(c.env.DB, user.id, profile.time_zone));
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Toggle cozy nap posture in D1.
mascot.post('/nap', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'mascot-write', 60, 60, user.id);
  const body = allowed ? await jsonObject(c).catch(always<Readonly<Record<string, unknown>>>({})) : null;
  // eslint-disable-next-line functional/no-conditional-statements -- Validate boolean napping flag before persisting.
  if (!allowed || !body || typeof body.napping !== 'boolean') {
    return c.json({ error: allowed ? 'Choose whether Petal is napping.' : 'Please slow down.' }, allowed ? 400 : 429);
  }
  const profile = await ensureProfile(c.env.DB, user.id, body.tz);
  // eslint-disable-next-line functional/no-expression-statements -- Persist nap state in D1.
  await c.env.DB.prepare('UPDATE mascot_profiles SET napping = ?, updated_at = ? WHERE user_id = ?')
    .bind(body.napping ? 1 : 0, new Date().toISOString(), user.id).run();
  return c.json(await loadState(c.env.DB, user.id, profile.time_zone));
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Persist user spring-physics animation feel preference.
mascot.post('/preferences', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'mascot-write', 60, 60, user.id);
  const body = allowed ? await jsonObject(c).catch(always<Readonly<Record<string, unknown>>>({})) : null;
  // eslint-disable-next-line functional/no-conditional-statements -- Validate springFeel option before updating D1.
  if (!allowed || !body || !isSpringFeel(body.springFeel)) {
    return c.json({ error: allowed ? 'Choose jelly, plush, or calm animation feel.' : 'Please slow down.' }, allowed ? 400 : 429);
  }
  const profile = await ensureProfile(c.env.DB, user.id, body.tz);
  // eslint-disable-next-line functional/no-expression-statements -- Persist animation feel preference in D1.
  await c.env.DB.prepare('UPDATE mascot_profiles SET spring_feel = ?, updated_at = ? WHERE user_id = ?')
    .bind(body.springFeel, new Date().toISOString(), user.id).run();
  return c.json(await loadState(c.env.DB, user.id, profile.time_zone));
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Idempotently reward a completed family quick-timer or roulette activity completed today.
mascot.post('/claim-event', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'mascot-write', 60, 60, user.id);
  const body = allowed ? await jsonObject(c).catch(always<Readonly<Record<string, unknown>>>({})) : null;
  // eslint-disable-next-line functional/no-conditional-statements -- Require a valid eventId before querying D1.
  if (!allowed || !body || typeof body.eventId !== 'string' || !body.eventId.trim()) {
    return c.json({ error: allowed ? 'Provide a completed schedule ID.' : 'Please slow down.' }, allowed ? 400 : 429);
  }
  const profile = await ensureProfile(c.env.DB, user.id, body.tz);
  const eventRow = await c.env.DB.prepare(`
    SELECT e.id, e.title, e.start_at, e.target_at, e.repeat_unit
    FROM events e JOIN users u ON u.id = e.owner_id
    WHERE e.id = ? AND u.family_id = ?
  `).bind(body.eventId.trim(), user.familyId).first<ScheduleClaimSource>();

  // eslint-disable-next-line functional/no-conditional-statements -- Reject unknown or cross-family schedule IDs.
  if (!eventRow) return c.json({ error: 'Schedule not found.' }, 404);
  const nowMs = Date.now();
  const targetMs = Date.parse(eventRow.target_at);
  const startMs = Date.parse(eventRow.start_at);
  // eslint-disable-next-line functional/no-conditional-statements -- Only completed one-time timers/activities finishing today grant mascot XP and fatigue.
  if (eventRow.repeat_unit !== 'none' || !Number.isFinite(targetMs) || targetMs > nowMs || localDayKey(targetMs, profile.time_zone) !== profile.day_key) {
    return c.json({ awarded: false, xpGain: 0, effortDelta: 0, state: await loadState(c.env.DB, user.id, profile.time_zone) });
  }

  const stamp = new Date(nowMs).toISOString();
  const inserted: WriteResult = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO mascot_claimed_events (user_id, event_id, claimed_at) VALUES (?, ?, ?)
  `).bind(user.id, eventRow.id, stamp).run();

  // eslint-disable-next-line functional/no-conditional-statements -- Avoid duplicate XP when the same completed schedule is reported twice or across tabs.
  if (!inserted.meta.changes) {
    return c.json({ awarded: false, xpGain: 0, effortDelta: 0, state: await loadState(c.env.DB, user.id, profile.time_zone) });
  }

  const durationMinutes = Number.isFinite(startMs) ? Math.max(1, Math.round((targetMs - startMs) / 60000)) : 15;
  const reward = rewardForCompletedSchedule(eventRow.title, durationMinutes);
  const nextXp = profile.xp + reward.xp;
  const nextEffort = reward.effortDelta >= 0
    ? clamp(0, MAX_EFFORT_POINTS, profile.effort_points + reward.effortDelta)
    : profile.effort_points;
  const nextRest = reward.effortDelta < 0
    ? clamp(0, MAX_REST_POINTS, profile.rest_points + Math.abs(reward.effortDelta))
    : profile.rest_points;
  const nextStreak = nextStreakValue(profile.streak, profile.last_active_day, profile.day_key);

  // eslint-disable-next-line functional/no-expression-statements -- Apply schedule reward to user's mascot profile in D1.
  await c.env.DB.prepare(`
    UPDATE mascot_profiles
    SET xp = ?, effort_points = ?, rest_points = ?, streak = ?, last_active_day = ?, napping = 0, updated_at = ?
    WHERE user_id = ?
  `).bind(nextXp, nextEffort, nextRest, nextStreak, profile.day_key, stamp, user.id).run();

  return c.json({
    awarded: true,
    xpGain: reward.xp,
    effortDelta: reward.effortDelta,
    state: await loadState(c.env.DB, user.id, profile.time_zone),
  });
});
