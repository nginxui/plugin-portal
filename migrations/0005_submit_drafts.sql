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
