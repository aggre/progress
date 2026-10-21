CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 title TEXT NOT NULL,
 emoji TEXT NOT NULL,
 color TEXT NOT NULL,
 start_at TEXT NOT NULL,
 target_at TEXT NOT NULL,
 repeat_unit TEXT NOT NULL CHECK (repeat_unit IN ('none','minute','hour','day','week','month','year')),
 repeat_every INTEGER NOT NULL CHECK (repeat_every BETWEEN 1 AND 1000),
 time_zone TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_owner_created ON events(owner, created_at, id);
