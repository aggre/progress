CREATE TABLE push_subscriptions (
 id TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL UNIQUE REFERENCES sessions(token_hash) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 minutes INTEGER NOT NULL CHECK(minutes IN (1,5,10,15,30,60)),
 vapid_public_key TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE push_deliveries (
 subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_at INTEGER NOT NULL,
 claim_token TEXT NOT NULL,
 lease_until INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 1,
 next_attempt_at INTEGER NOT NULL,
 sent_at INTEGER,
 PRIMARY KEY (subscription_id,event_id,occurrence_at)
);
CREATE INDEX push_delivery_expiry ON push_deliveries(occurrence_at);

-- Logout revokes the session without deleting it, to prevent login replay.
CREATE TRIGGER revoke_session_push AFTER UPDATE OF expires_at ON sessions
WHEN NEW.expires_at <= unixepoch() BEGIN
 DELETE FROM push_subscriptions WHERE session_hash=NEW.token_hash;
END;
