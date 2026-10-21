-- Preserve the old email-owned rows without exposing them through the new API.
ALTER TABLE events RENAME TO legacy_events;
DROP INDEX IF EXISTS events_owner_created;
CREATE TABLE families (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE users (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 32),
 family_id TEXT NOT NULL REFERENCES families(id),
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX users_family ON users(family_id, created_at);
CREATE TABLE login_challenges (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL,
 poll_hash TEXT NOT NULL UNIQUE,
 approval_hash TEXT NOT NULL UNIQUE,
 session_hash TEXT NOT NULL UNIQUE,
 verification_code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved')),
 approved_user_id TEXT REFERENCES users(id),
 approved_by TEXT REFERENCES users(id),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 approved_at INTEGER
);
CREATE INDEX challenge_expiry ON login_challenges(expires_at);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 challenge_id TEXT NOT NULL UNIQUE REFERENCES login_challenges(id),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TRIGGER activate_approved_login AFTER UPDATE OF status ON login_challenges
WHEN OLD.status='pending' AND NEW.status='approved' BEGIN
 INSERT INTO sessions(token_hash,user_id,challenge_id,created_at,expires_at) VALUES(NEW.session_hash,NEW.approved_user_id,NEW.id,unixepoch(),unixepoch()+2592000);
END;
CREATE TABLE rate_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limit_expiry ON rate_limits(expires_at);
CREATE TABLE events (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 emoji TEXT NOT NULL,
 color TEXT NOT NULL,
 start_at TEXT NOT NULL,
 target_at TEXT NOT NULL,
 repeat_unit TEXT NOT NULL CHECK(repeat_unit IN ('none','minute','hour','day','week','month','year')),
 repeat_every INTEGER NOT NULL CHECK(repeat_every BETWEEN 1 AND 1000),
 time_zone TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX events_owner_created ON events(owner_id, created_at, id);
-- Only a control-plane operator can insert here. There is no HTTP bootstrap route.
-- The singleton and trigger make first-user creation one atomic SQL statement.
CREATE TABLE bootstrap_approvals (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 challenge_id TEXT NOT NULL UNIQUE REFERENCES login_challenges(id),
 expected_username TEXT NOT NULL,
 family_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 family_name TEXT NOT NULL CHECK(length(family_name) BETWEEN 1 AND 80),
 claim_legacy INTEGER NOT NULL DEFAULT 0 CHECK(claim_legacy IN (0,1)),
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TRIGGER bootstrap_first_user AFTER INSERT ON bootstrap_approvals BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM users) THEN RAISE(ABORT,'Bootstrap is already complete') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM login_challenges WHERE id=NEW.challenge_id AND username=NEW.expected_username COLLATE NOCASE AND status='pending' AND expires_at>unixepoch()) THEN RAISE(ABORT,'Pending login does not match or has expired') END;
 INSERT INTO families(id,name) VALUES(NEW.family_id,NEW.family_name);
 INSERT INTO users(id,username,family_id) SELECT NEW.user_id,username,NEW.family_id FROM login_challenges WHERE id=NEW.challenge_id;
 UPDATE login_challenges SET status='approved',approved_user_id=NEW.user_id,approved_at=unixepoch() WHERE id=NEW.challenge_id;
 INSERT INTO events(id,owner_id,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at) SELECT id,NEW.user_id,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at FROM legacy_events WHERE NEW.claim_legacy=1;
END;
