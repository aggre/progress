ALTER TABLE roulettes ADD COLUMN play_minutes INTEGER NOT NULL DEFAULT 30 CHECK(play_minutes BETWEEN 1 AND 240);
ALTER TABLE roulettes ADD COLUMN after_task TEXT CHECK(after_task IS NULL OR (json_valid(after_task) AND json_type(after_task) = 'object'));
ALTER TABLE events ADD COLUMN activity_plan TEXT CHECK(activity_plan IS NULL OR (json_valid(activity_plan) AND json_type(activity_plan) = 'object'));
ALTER TABLE events ADD COLUMN roulette_start_key TEXT;
CREATE UNIQUE INDEX events_roulette_start ON events(owner_id, roulette_start_key);
