import type { ScheduleEvent } from '@little/shared/events';
import { dueReminders, type Reminder } from '@little/shared/reminders';
import { pushConfig, pushRecipient, type PushRow } from './push';
import { sendWebPush, type WebPushConfig } from './web-push';
import type { ApiBindings } from './types';

interface Subscriber extends PushRow { readonly family_id: string; }
interface Claim { readonly claim_token: string; readonly attempts: number; }

// eslint-disable-next-line functional/prefer-immutable-types -- Acquire an atomic D1 delivery lease, then await the encrypted HTTP send and persist its outcome.
async function deliverReminder(env: ApiBindings, subscriber: Subscriber, reminder: Reminder, config: WebPushConfig, now: number): Promise<void> {
  const claimNow = Math.max(now, Date.now());
  // eslint-disable-next-line functional/no-conditional-statements -- A late cron or an earlier slow delivery must not send reminders after the target time.
  if (reminder.end <= claimNow) return;
  const claim = await env.DB.prepare(`
    INSERT INTO push_deliveries (subscription_id,event_id,occurrence_at,claim_token,lease_until,attempts,next_attempt_at)
    SELECT ?,?,?,?,?,1,? WHERE EXISTS (
      SELECT 1 FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash JOIN users viewer ON viewer.id=s.user_id
      JOIN events e ON e.id=? JOIN users creator ON creator.id=e.owner_id
      WHERE p.id=? AND p.revision=? AND p.vapid_public_key=? AND s.expires_at>? AND creator.family_id=viewer.family_id AND e.updated_at=?
    )
    ON CONFLICT(subscription_id,event_id,occurrence_at) DO UPDATE SET claim_token=excluded.claim_token,
      lease_until=excluded.lease_until,attempts=push_deliveries.attempts+1
    WHERE push_deliveries.sent_at IS NULL AND push_deliveries.lease_until<=? AND push_deliveries.next_attempt_at<=? AND push_deliveries.attempts<5
    RETURNING claim_token,attempts
  `).bind(subscriber.id, reminder.event.id, reminder.end, crypto.randomUUID(), claimNow + 120_000, claimNow,
    reminder.event.id, subscriber.id, subscriber.revision, config.publicKey, Math.floor(claimNow / 1000), reminder.event.updatedAt, claimNow, claimNow).first<Claim>();
  // eslint-disable-next-line functional/no-conditional-statements -- Another cron invocation, a completed receipt, or a revoked subscription owns this occurrence.
  if (!claim) return;
  // eslint-disable-next-line functional/no-try-statements -- Preserve retryability on network failures and provider errors without leaking endpoints or payloads into logs.
  try {
    const current = await env.DB.prepare(`SELECT 1 AS current FROM push_deliveries d
      JOIN push_subscriptions p ON p.id=d.subscription_id JOIN sessions s ON s.token_hash=p.session_hash
      JOIN users viewer ON viewer.id=s.user_id JOIN events e ON e.id=d.event_id JOIN users creator ON creator.id=e.owner_id
      WHERE d.subscription_id=? AND d.event_id=? AND d.occurrence_at=? AND d.claim_token=? AND d.sent_at IS NULL
        AND p.revision=? AND p.vapid_public_key=? AND s.expires_at>? AND viewer.family_id=creator.family_id AND e.updated_at=?`)
      .bind(subscriber.id, reminder.event.id, reminder.end, claim.claim_token, subscriber.revision, config.publicKey,
        Math.floor(Math.max(now, Date.now()) / 1000), reminder.event.updatedAt).first<Readonly<{ current: number }>>();
    // eslint-disable-next-line functional/no-conditional-statements -- Cancel claims invalidated by logout, edits, or unsubscription while their D1 request was pending.
    if (!current) {
      // eslint-disable-next-line functional/no-expression-statements -- Release only this claim so an edited event can be reconsidered at the next cron tick.
      await env.DB.prepare('DELETE FROM push_deliveries WHERE subscription_id=? AND event_id=? AND occurrence_at=? AND claim_token=? AND sent_at IS NULL')
        .bind(subscriber.id, reminder.event.id, reminder.end, claim.claim_token).run();
      return;
    }
    const sendAt = Math.max(now, Date.now());
    // eslint-disable-next-line functional/no-conditional-statements -- Recheck the target after the asynchronous lease acquisition.
    if (reminder.end <= sendAt) return;
    const target = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: reminder.event.timeZone }).format(reminder.end);
    const result = await sendWebPush(pushRecipient(subscriber), JSON.stringify({
      title: `${reminder.event.emoji} ${reminder.event.title}`, body: `Coming up at ${target} (${reminder.event.timeZone}).`,
      tag: `little:${subscriber.id}:${reminder.event.id}:${reminder.end}`, url: env.APP_BASE_URL, targetAt: reminder.end,
    }), config, Math.max(1, Math.floor((reminder.end - sendAt) / 1000)));
    // eslint-disable-next-line functional/no-conditional-statements -- Commit success or revoke a permanently expired endpoint at the persistence boundary.
    if (result.status >= 200 && result.status < 300) {
      // eslint-disable-next-line functional/no-expression-statements -- Only the owner of this lease may mark the occurrence sent.
      await env.DB.prepare('UPDATE push_deliveries SET sent_at=?,lease_until=0 WHERE subscription_id=? AND event_id=? AND occurrence_at=? AND claim_token=?')
        .bind(Math.max(now, Date.now()), subscriber.id, reminder.event.id, reminder.end, claim.claim_token).run();
      return;
    }
    // eslint-disable-next-line functional/no-conditional-statements -- The provider has permanently removed this browser endpoint.
    if (result.status === 404 || result.status === 410) {
      // eslint-disable-next-line functional/no-expression-statements -- Do not delete a newer subscription created while this request was in flight.
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND revision=?').bind(subscriber.id, subscriber.revision).run();
      return;
    }
  } catch { /* Retry at a later cron tick while the occurrence is still in the future. */ }
  // eslint-disable-next-line functional/no-expression-statements -- Release the lease with exponential backoff, capped by five attempts and the event's target time.
  await env.DB.prepare('UPDATE push_deliveries SET lease_until=0,next_attempt_at=? WHERE subscription_id=? AND event_id=? AND occurrence_at=? AND claim_token=?')
    .bind(Math.max(now, Date.now()) + Math.min(15, 2 ** (claim.attempts - 1)) * 60_000, subscriber.id, reminder.event.id, reminder.end, claim.claim_token).run();
}

// eslint-disable-next-line functional/prefer-immutable-types -- Load a subscriber's current family events and send matching occurrences through D1 and HTTP.
async function notifySubscriber(env: ApiBindings, subscriber: Subscriber, config: WebPushConfig, now: number): Promise<void> {
  const currentTime = Math.max(now, Date.now());
  const events: Readonly<Record<number, ScheduleEvent>> = (await env.DB.prepare(`
    SELECT e.id,e.title,e.emoji,e.color,e.start_at AS startAt,e.target_at AS targetAt,e.repeat_unit AS repeatUnit,
      e.repeat_every AS repeatEvery,e.time_zone AS timeZone,e.created_at AS createdAt,e.updated_at AS updatedAt
    FROM events e JOIN users u ON u.id=e.owner_id WHERE u.family_id=? AND (e.repeat_unit!='none' OR julianday(e.target_at)>julianday(?))
  `).bind(subscriber.family_id, new Date(currentTime).toISOString()).all<ScheduleEvent>()).results;
  const reminders = dueReminders(events, currentTime, { enabled: true, minutes: subscriber.minutes }, {});
  // eslint-disable-next-line functional/no-loop-statements -- Bound outgoing concurrency by awaiting each subscriber's delivery in sequence.
  for (const reminder of Object.values(reminders)) {
    // eslint-disable-next-line functional/no-expression-statements -- Complete the transport and receipt write before attempting the next occurrence.
    await deliverReminder(env, subscriber, reminder, config, currentTime);
  }
}

// eslint-disable-next-line functional/prefer-immutable-types -- A cron invocation pages through active D1 subscriptions and awaits all notification work.
export async function runPushReminders(env: ApiBindings, now: number): Promise<void> {
  const config = pushConfig(env);
  // eslint-disable-next-line functional/no-conditional-statements -- Missing VAPID configuration leaves the feature disabled without sending or scanning schedules.
  if (!config) return;
  const startedAt = Math.max(now, Date.now());
  // eslint-disable-next-line functional/no-expression-statements -- Drop old receipts and expired subscriptions before querying the next batch.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_deliveries WHERE occurrence_at<=?').bind(startedAt),
    env.DB.prepare('DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)').bind(Math.floor(startedAt / 1000)),
  ]);
  // eslint-disable-next-line functional/no-let -- Keep the keyset pagination cursor local to this scheduled persistence operation.
  let cursor = '';
  // eslint-disable-next-line functional/no-loop-statements -- Keyset pagination bounds resident subscription data and outgoing request concurrency to five browsers.
  while (true) {
    const subscribers: Readonly<Record<number, Subscriber>> = (await env.DB.prepare(`
      SELECT p.*,u.family_id FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash JOIN users u ON u.id=s.user_id
      WHERE p.id>? AND p.vapid_public_key=? AND s.expires_at>? ORDER BY p.id LIMIT 5
    `).bind(cursor, config.publicKey, Math.floor(startedAt / 1000)).all<Subscriber>()).results;
    const last = Object.values(subscribers).at(-1);
    // eslint-disable-next-line functional/no-conditional-statements -- End the cron pass when the keyset query is exhausted.
    if (!last) return;
    // eslint-disable-next-line functional/no-expression-statements, functional/prefer-immutable-types -- Await each native HTTP/D1 completion promise in this page before advancing the cursor.
    await Promise.all(Object.values(subscribers).map(subscriber => notifySubscriber(env, subscriber, config, startedAt)));
    // eslint-disable-next-line functional/no-expression-statements -- Advance the D1 keyset cursor only after this batch has settled.
    cursor = last.id;
  }
}
