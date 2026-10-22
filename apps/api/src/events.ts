import { Hono } from 'hono';
import { validateEvent, type ScheduleEvent } from '@little/shared/events';
import type { ScheduleRecord, User } from '@little/shared/api';
import { jsonObject, requireAuth, throttle } from './security';
import type { AppEnv } from './types';

interface Row {
  readonly id: string; readonly owner_id: string; readonly username: string; readonly title: string; readonly emoji: string; readonly color: string;
  readonly start_at: string; readonly target_at: string; readonly repeat_unit: ScheduleEvent['repeatUnit']; readonly repeat_every: number;
  readonly time_zone: string; readonly created_at: string; readonly updated_at: string;
}

function map(r: Row, viewer: string): ScheduleRecord {
  return {
    id: r.id, title: r.title, emoji: r.emoji, color: r.color, startAt: r.start_at,
    targetAt: r.target_at, repeatUnit: r.repeat_unit, repeatEvery: r.repeat_every,
    timeZone: r.time_zone, createdAt: r.created_at, updatedAt: r.updated_at,
    createdBy: { id: r.owner_id, username: r.username }, canEdit: r.owner_id === viewer,
  };
}

export const events = new Hono<AppEnv>();
events.use('*', requireAuth);

events.get('/', async c => {
  const user: Readonly<User> = c.get('identity').user;
  // Resolve sharing through the creator's current family, including existing events.
  const result = await c.env.DB.prepare(`
    SELECT e.*, u.username FROM events e JOIN users u ON u.id = e.owner_id
    WHERE u.family_id = ? ORDER BY e.created_at, e.id
  `).bind(user.familyId).all<Row>();
  return c.json({ events: result.results.map(row => map(row, user.id)) });
});

events.post('/', async c => {
  const user: Readonly<User> = c.get('identity').user;
  if (!await throttle(c, 'event-write', 60, 60, user.id)) return c.json({ error: 'Please slow down.' }, 429);
  let input;
  try { input = validateEvent(await jsonObject(c)); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Invalid event.' }, 400); }
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  const result = await c.env.DB.prepare('INSERT INTO events (id,owner_id,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM events WHERE owner_id=?)<500')
    .bind(id, user.id, input.title, input.emoji, input.color, input.startAt, input.targetAt, input.repeatUnit, input.repeatEvery, input.timeZone, stamp, stamp, user.id).run();
  if (!result.meta.changes) return c.json({ error: 'You have reached the limit of 500 events.' }, 409);
  const event: ScheduleRecord = {
    id, ...input, createdAt: stamp, updatedAt: stamp,
    createdBy: { id: user.id, username: user.username }, canEdit: true,
  };
  return c.json({ event }, 201);
});

events.put('/:id', async c => {
  const owner = c.get('identity').user.id;
  if (!await throttle(c, 'event-write', 60, 60, owner)) return c.json({ error: 'Please slow down.' }, 429);
  let input;
  try { input = validateEvent(await jsonObject(c)); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Invalid event.' }, 400); }
  const id = c.req.param('id'), stamp = new Date().toISOString();
  const result = await c.env.DB.prepare('UPDATE events SET title=?,emoji=?,color=?,start_at=?,target_at=?,repeat_unit=?,repeat_every=?,time_zone=?,updated_at=? WHERE id=? AND owner_id=?')
    .bind(input.title, input.emoji, input.color, input.startAt, input.targetAt, input.repeatUnit, input.repeatEvery, input.timeZone, stamp, id, owner).run();
  if (!result.meta.changes) return c.json({ error: 'This event no longer exists.' }, 404);
  const row = await c.env.DB.prepare('SELECT e.*, u.username FROM events e JOIN users u ON u.id=e.owner_id WHERE e.id=? AND e.owner_id=?').bind(id, owner).first<Row>();
  return c.json({ event: row ? map(row, owner) : null });
});

events.delete('/:id', async c => {
  const owner = c.get('identity').user.id;
  if (!await throttle(c, 'event-write', 60, 60, owner)) return c.json({ error: 'Please slow down.' }, 429);
  const result = await c.env.DB.prepare('DELETE FROM events WHERE id=? AND owner_id=?').bind(c.req.param('id'), owner).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: 'This event no longer exists.' }, 404);
});
