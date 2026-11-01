CREATE TABLE roulettes (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
 options TEXT NOT NULL CHECK(json_valid(options) AND json_type(options) = 'array' AND json_array_length(options) BETWEEN 2 AND 20),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX roulettes_owner ON roulettes(owner_id, created_at);
