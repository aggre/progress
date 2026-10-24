import { Hono } from 'hono';
import { validateEvent, type ScheduleEvent } from '@little/shared/events';
import type { ScheduleRecord, User } from '@little/shared/api';
import { jsonObject, requireAuth, throttle } from './security';
import type { AppEnv } from './types';

type WriteResult = Readonly<{ meta: Readonly<{ changes: number }> }>;

interface Row {
  readonly id: string; readonly owner_id: string; readonly username: string; readonly title: string; readonly emoji: string; readonly color: string;
  readonly start_at: string; readonly target_at: string; readonly repeat_unit: ScheduleEvent['repeatUnit']; readonly repeat_every: number;
  readonly time_zone: string; readonly created_at: string; readonly updated_at: string;
}

function validationFailure(error: unknown): Readonly<{ error: string }> {
  return { error: error instanceof Error ? error.message : 'Invalid event.' };
}

function map(r: Row, viewer: string): Readonly<ScheduleRecord> {
  return {
    id: r.id, title: r.title, emoji: r.emoji, color: r.color, startAt: r.start_at,
    targetAt: r.target_at, repeatUnit: r.repeat_unit, repeatEvery: r.repeat_every,
    timeZone: r.time_zone, createdAt: r.created_at, updatedAt: r.updated_at,
    createdBy: { id: r.owner_id, username: r.username }, canEdit: r.owner_id === viewer,
  };
}

export const events = new Hono<AppEnv>();
// eslint-disable-next-line functional/no-expression-statements -- Attach authentication middleware to the schedule router.
events.use('*', requireAuth);

// eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Register the schedule listing HTTP endpoint, which reads the native Hono context and returns its D1/response completion Promise.
events.get('/', async c => {
  const user: Readonly<User> = c.get('identity').user;
  // Resolve sharing through the creator's current family, including existing events.
  const result = await c.env.DB.prepare(`
    SELECT e.*, u.username FROM events e JOIN users u ON u.id = e.owner_id
    WHERE u.family_id = ? ORDER BY e.created_at, e.id
  `).bind(user.familyId).all<Row>();
  return c.json({ events: result.results.map(row => map(row, user.id)) });
});

// eslint-disable-next-line functional/no-expression-statements -- Register the schedule creation HTTP endpoint with the Hono router.
events.post('/', async c => {
  const user: Readonly<User> = c.get('identity').user;
  const allowed = await throttle(c, 'event-write', 60, 60, user.id);
  const input = allowed ? await jsonObject(c).then(validateEvent).catch(validationFailure)
    : { error: 'Please slow down.' } as const;
  if (!allowed || 'error' in input) return c.json(input, allowed ? 400 : 429);
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  const result: WriteResult = await c.env.DB.prepare('INSERT INTO events (id,owner_id,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM events WHERE owner_id=?)<500')
    .bind(id, user.id, input.title, input.emoji, input.color, input.startAt, input.targetAt, input.repeatUnit, input.repeatEvery, input.timeZone, stamp, stamp, user.id).run();
  const event: Readonly<ScheduleRecord> = {
    id, ...input, createdAt: stamp, updatedAt: stamp,
    createdBy: { id: user.id, username: user.username }, canEdit: true,
  };
  return !result.meta.changes ? c.json({ error: 'You have reached the limit of 500 events.' }, 409)
    : c.json({ event }, 201);
});

// eslint-disable-next-line functional/no-expression-statements -- Register the schedule update HTTP endpoint with the Hono router.
events.put('/:id', async c => {
  const owner = c.get('identity').user.id;
  const allowed = await throttle(c, 'event-write', 60, 60, owner);
  const input = allowed ? await jsonObject(c).then(validateEvent).catch(validationFailure)
    : { error: 'Please slow down.' } as const;
  if (!allowed || 'error' in input) return c.json(input, allowed ? 400 : 429);
  const id = c.req.param('id'), stamp = new Date().toISOString();
  const result: WriteResult = await c.env.DB.prepare('UPDATE events SET title=?,emoji=?,color=?,start_at=?,target_at=?,repeat_unit=?,repeat_every=?,time_zone=?,updated_at=? WHERE id=? AND owner_id=?')
    .bind(input.title, input.emoji, input.color, input.startAt, input.targetAt, input.repeatUnit, input.repeatEvery, input.timeZone, stamp, id, owner).run();
  const row = result.meta.changes
    ? await c.env.DB.prepare('SELECT e.*, u.username FROM events e JOIN users u ON u.id=e.owner_id WHERE e.id=? AND e.owner_id=?').bind(id, owner).first<Row>() : null;
  return !result.meta.changes ? c.json({ error: 'This event no longer exists.' }, 404)
    : c.json({ event: row ? map(row, owner) : null });
});

// eslint-disable-next-line functional/no-expression-statements -- Register the schedule deletion HTTP endpoint with the Hono router.
events.delete('/:id', async c => {
  const owner = c.get('identity').user.id;
  if (!await throttle(c, 'event-write', 60, 60, owner)) return c.json({ error: 'Please slow down.' }, 429);
  const result: WriteResult = await c.env.DB.prepare('DELETE FROM events WHERE id=? AND owner_id=?').bind(c.req.param('id'), owner).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: 'This event no longer exists.' }, 404);
});
