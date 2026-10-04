-- What the portal added to the schema after its first release.

-- What the portal sent to apply.yml, when, and the latest outcome it reported.
ALTER TABLE changes ADD COLUMN payload_json TEXT;
ALTER TABLE changes ADD COLUMN dispatched_at INTEGER;
ALTER TABLE changes ADD COLUMN outcome_json TEXT;

-- When a user last read their notifications.
ALTER TABLE notify_prefs ADD COLUMN read_at INTEGER;

-- Partner applications and key requests, decided by maintainers. An approved
-- one becomes a pull request on partners/<name>.json in the catalog.
CREATE TABLE partner_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('application', 'profile', 'key_rotation', 'key_revocation')),
  owner_login TEXT,
  vendor_id INTEGER,
  partner TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  submitted_by INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'declined')),
  reason TEXT,
  decided_by INTEGER,
  decided_at INTEGER,
  change_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX partner_requests_state ON partner_requests (state, created_at);

-- Where background jobs left off.
CREATE TABLE job_state (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Submissions a user started and has not sent yet, so they can be continued
-- from any device.
CREATE TABLE submit_drafts (
  user_id INTEGER NOT NULL,
  repo_full_name TEXT NOT NULL COLLATE NOCASE,
  plugin_id TEXT,
  name_json TEXT,
  step INTEGER NOT NULL,
  problem_json TEXT,
  public_key TEXT,
  categories_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, repo_full_name)
);

-- AI pre-reviews of changes for maintainers, one per change and language.
CREATE TABLE ai_reviews (
  change_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (change_id, locale)
);
