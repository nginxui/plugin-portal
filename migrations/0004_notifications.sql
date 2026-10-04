-- When a user last read their notifications, and where background jobs left off.
ALTER TABLE notify_prefs ADD COLUMN read_at INTEGER;
CREATE TABLE job_state (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
