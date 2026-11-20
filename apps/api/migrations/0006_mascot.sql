CREATE TABLE mascot_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0),
 streak INTEGER NOT NULL DEFAULT 0 CHECK(streak >= 0),
 last_active_day TEXT,
 day_key TEXT NOT NULL,
 effort_points INTEGER NOT NULL DEFAULT 0 CHECK(effort_points BETWEEN 0 AND 80),
 rest_points INTEGER NOT NULL DEFAULT 0 CHECK(rest_points BETWEEN 0 AND 65),
 napping INTEGER NOT NULL DEFAULT 0 CHECK(napping IN (0, 1)),
 spring_feel TEXT NOT NULL DEFAULT 'plush' CHECK(spring_feel IN ('jelly', 'plush', 'calm')),
 time_zone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
 updated_at TEXT NOT NULL
);

CREATE TABLE mascot_goals (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 60),
 emoji TEXT NOT NULL CHECK(length(emoji) BETWEEN 1 AND 16),
 color TEXT NOT NULL,
 xp_reward INTEGER NOT NULL DEFAULT 25 CHECK(xp_reward BETWEEN 5 AND 100),
 effort_delta INTEGER NOT NULL DEFAULT 12 CHECK(effort_delta BETWEEN -40 AND 40),
 completed_day TEXT,
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);

CREATE INDEX mascot_goals_user ON mascot_goals(user_id, sort_order, created_at);

CREATE TABLE mascot_claimed_events (
 user_id TEXT NOT NULL REFERENCES users(id),
 event_id TEXT NOT NULL,
 claimed_at TEXT NOT NULL,
 PRIMARY KEY (user_id, event_id)
);
