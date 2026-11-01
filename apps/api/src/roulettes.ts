import { Hono } from 'hono';
import { validateRoulette } from '@little/shared/roulette';
import { activityMinutes, matchesStart, validateRouletteStart, type AfterTask, type ActivityRun } from '@little/shared/activity';
import { mapEvent, type EventRow } from './events';
import type { RouletteRecord, User } from '@little/shared/api';
import { jsonObject, requireAuth, throttle } from './security';
import type { AppEnv } from './types';

type WriteResult = Readonly<{ meta: Readonly<{ changes: number }> }>;

interface Row {
  readonly id: string; readonly owner_id: string; readonly username: string;
  readonly play_minutes: number; readonly after_task: string | null;
  readonly title: string; readonly options: string; readonly created_at: string; readonly updated_at: string;
}

function validationFailure(error: unknown): Readonly<{ error: string }> {
  return { error: error instanceof Error ? error.message : 'Invalid roulette.' };
}

function map(r: Row, viewer: string): Readonly<RouletteRecord> {
  return {
    id: r.id, title: r.title, options: JSON.parse(r.options) as readonly string[],
    playMinutes: r.play_minutes, afterTask: r.after_task ? JSON.parse(r.after_task) as AfterTask : null,
    createdAt: r.created_at, updatedAt: r.updated_at,
    createdBy: { id: r.owner_id, username: r.username }, canEdit: r.owner_id === viewer,
  };
}

// eslint-disable-next-line functional/prefer-immutable-types -- Retain the native Hono router instance to register roulette HTTP handlers.
export const roulettes = new Hono<AppEnv>();
// eslint-disable-next-line functional/no-expression-statements -- Attach authentication middleware to the roulette router.
roulettes.use('*', requireAuth);

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the roulette listing HTTP endpoint, which reads the native Hono context and returns its D1/response completion Promise.
roulettes.get('/', async c => {
  const user: Readonly<User> = c.get('identity').user;
  // Resolve sharing through the creator's current family, including existing roulettes.
  return c.json({ roulettes: (await c.env.DB.prepare(`
    SELECT e.*, u.username FROM roulettes e JOIN users u ON u.id = e.owner_id
    WHERE u.family_id = ? ORDER BY e.created_at, e.id
  `).bind(user.familyId).all<Row>()).results.map(row => map(row, user.id)) });
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register roulette creation using the native Hono request context and D1/response completion Promise.
roulettes.post('/', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'roulette-write', 60, 60, user.id);
  const input = allowed ? await jsonObject(c).then(validateRoulette).catch(validationFailure)
    : { error: 'Please slow down.' } as const;
  const valid = allowed && !('error' in input);
  const id = valid ? crypto.randomUUID() : '', stamp = valid ? new Date().toISOString() : '';
  const result: WriteResult | null = valid ? await c.env.DB.prepare('INSERT INTO roulettes (id,owner_id,title,options,play_minutes,after_task,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM roulettes WHERE owner_id=?)<100')
    .bind(id, user.id, input.title, JSON.stringify(input.options), input.playMinutes, input.afterTask ? JSON.stringify(input.afterTask) : null, stamp, stamp, user.id).run() : null;
  return !valid ? c.json(input, allowed ? 400 : 429)
    : !result?.meta.changes ? c.json({ error: 'You have reached the limit of 100 roulettes.' }, 409)
    : c.json({ roulette: {
      id, ...input, createdAt: stamp, updatedAt: stamp,
      createdBy: { id: user.id, username: user.username }, canEdit: true,
    } satisfies Readonly<RouletteRecord> }, 201);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Start a family activity with one atomic D1 write and an idempotent HTTP response.
roulettes.post('/:id/start', async c => {
  const user = c.get('identity').user, rouletteId = c.req.param('id');
  const allowed = await throttle(c, 'event-write', 60, 60, user.id);
  const input = allowed ? await jsonObject(c).then(validateRouletteStart).catch(validationFailure) : { error: 'Please slow down.' };
  // eslint-disable-next-line functional/no-conditional-statements -- Reject invalid HTTP input before reading or writing schedule data.
  if ('error' in input) return c.json(input, allowed ? 400 : 429);
  const previous = await c.env.DB.prepare('SELECT e.*,u.username FROM events e JOIN users u ON u.id=e.owner_id WHERE e.owner_id=? AND e.roulette_start_key=?')
    .bind(user.id, input.requestId).first<EventRow>();
  // eslint-disable-next-line functional/no-conditional-statements -- A retried start returns its original activity, even after the wheel is edited or deleted.
  if (previous) return matchesStart(mapEvent(previous, user.id).activity, rouletteId, input)
    ? c.json({ event: mapEvent(previous, user.id) }) : c.json({ error: 'This start request was already used. Spin again to start another activity.' }, 409);
  const row = await c.env.DB.prepare('SELECT r.*,u.username FROM roulettes r JOIN users u ON u.id=r.owner_id WHERE r.id=? AND u.family_id=?')
    .bind(rouletteId, user.familyId).first<Row>();
  // eslint-disable-next-line functional/no-conditional-statements -- Only a currently shared wheel can start an activity for this session.
  if (!row) return c.json({ error: 'This roulette is no longer available.' }, 404);
  // eslint-disable-next-line functional/no-conditional-statements -- Keep the saved activity consistent with the choices and task previewed by the user.
  if (input.version !== row.updated_at) return c.json({ error: 'This roulette has changed. Refresh Family roulettes and spin again.' }, 409);
  const roulette = map(row, user.id), title = roulette.options[input.choiceIndex];
  // eslint-disable-next-line functional/no-conditional-statements -- Reject an out-of-range choice before constructing the persisted activity.
  if (!title) return c.json({ error: 'Choose one of this roulette’s results.' }, 400);
  const activity: ActivityRun = { playMinutes: roulette.playMinutes, afterTask: roulette.afterTask, source: { rouletteId, choiceIndex: input.choiceIndex, version: input.version } };
  const stamp = new Date().toISOString(), target = new Date(Date.parse(stamp) + activityMinutes(activity) * 60000).toISOString();
  // Recheck family, version, and quota inside the INSERT. The unique key also
  // prevents concurrent taps or a network retry from creating two activities.
  const inserted = await c.env.DB.prepare(`
    INSERT INTO events (id,owner_id,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at,activity_plan,roulette_start_key)
    SELECT ?,?,?, '🎉','#7ba989',?,?,'none',1,'Asia/Tokyo',?,?,?,?
    FROM roulettes r JOIN users u ON u.id=r.owner_id
    WHERE r.id=? AND u.family_id=? AND r.updated_at=? AND (SELECT COUNT(*) FROM events WHERE owner_id=?)<500
    ON CONFLICT(owner_id,roulette_start_key) DO NOTHING RETURNING *
  `).bind(crypto.randomUUID(), user.id, title, stamp, target, stamp, stamp, JSON.stringify(activity), input.requestId, rouletteId, user.familyId, input.version, user.id)
    .first<Omit<EventRow, 'username'>>();
  const saved = inserted ? { ...inserted, username: user.username }
    : await c.env.DB.prepare('SELECT e.*,u.username FROM events e JOIN users u ON u.id=e.owner_id WHERE e.owner_id=? AND e.roulette_start_key=?')
      .bind(user.id, input.requestId).first<EventRow>();
  return !saved ? c.json({ error: 'Unable to start. Refresh your roulettes, or remove an old event if you have reached the limit of 500.' }, 409)
    : !matchesStart(mapEvent(saved, user.id).activity, rouletteId, input) ? c.json({ error: 'This start request was already used. Spin again to start another activity.' }, 409)
    : c.json({ event: mapEvent(saved, user.id) }, inserted ? 201 : 200);
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register roulette update using the native Hono request context and D1/response completion Promise.
roulettes.put('/:id', async c => {
  const owner = c.get('identity').user.id;
  const allowed = await throttle(c, 'roulette-write', 60, 60, owner);
  const input = allowed ? await jsonObject(c).then(validateRoulette).catch(validationFailure)
    : { error: 'Please slow down.' } as const;
  const valid = allowed && !('error' in input);
  const id = valid ? c.req.param('id') : '', stamp = valid ? new Date().toISOString() : '';
  const result: WriteResult | null = valid ? await c.env.DB.prepare('UPDATE roulettes SET title=?,options=?,play_minutes=?,after_task=?,updated_at=? WHERE id=? AND owner_id=?')
    .bind(input.title, JSON.stringify(input.options), input.playMinutes, input.afterTask ? JSON.stringify(input.afterTask) : null, stamp, id, owner).run() : null;
  const row = result?.meta.changes
    ? await c.env.DB.prepare('SELECT e.*, u.username FROM roulettes e JOIN users u ON u.id=e.owner_id WHERE e.id=? AND e.owner_id=?').bind(id, owner).first<Row>() : null;
  return !valid ? c.json(input, allowed ? 400 : 429)
    : !result?.meta.changes ? c.json({ error: 'This roulette no longer exists.' }, 404)
    : c.json({ roulette: row ? map(row, owner) : null });
});

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register roulette deletion using the native Hono request context and D1/response completion Promise.
roulettes.delete('/:id', async c => {
  const owner = c.get('identity').user.id;
  const allowed = await throttle(c, 'roulette-write', 60, 60, owner);
  const result: WriteResult | null = allowed ? await c.env.DB.prepare('DELETE FROM roulettes WHERE id=? AND owner_id=?').bind(c.req.param('id'), owner).run() : null;
  return !allowed ? c.json({ error: 'Please slow down.' }, 429)
    : result?.meta.changes ? c.json({ ok: true }) : c.json({ error: 'This roulette no longer exists.' }, 404);
});
