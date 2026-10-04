-- Workflow state of the portal. The catalog repository stays the source of
-- truth for listings; nothing here is needed to rebuild the catalog.
-- Times are unix seconds.

CREATE TABLE users (
  id INTEGER PRIMARY KEY, -- GitHub user id
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX users_login ON users (login COLLATE NOCASE);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, -- sha256 of the cookie value
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_enc TEXT NOT NULL,
  token_expires_at INTEGER,
  refresh_enc TEXT,
  refresh_expires_at INTEGER,
  is_maintainer INTEGER NOT NULL DEFAULT 0,
  maintainer_checked_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Catalog App installation events, written by the release webhook Worker.
CREATE TABLE installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  repo_id INTEGER NOT NULL,
  repo_full_name TEXT NOT NULL,
  installed_by INTEGER NOT NULL,
  installed_by_login TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  removed_at INTEGER
);
CREATE INDEX installations_repo ON installations (repo_id);
CREATE INDEX installations_user ON installations (installed_by);

CREATE TABLE owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER UNIQUE, -- null for a vendor without a repository
  github_login TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'organization', 'vendor')),
  name TEXT,
  avatar_url TEXT,
  partner TEXT, -- name of partners/<name>.json
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Cache of a user's permission on a plugin repository, kept a few minutes.
CREATE TABLE repo_permissions (
  user_id INTEGER NOT NULL,
  repo_full_name TEXT NOT NULL COLLATE NOCASE,
  repo_id INTEGER, -- null when the repository could not be read
  owner_login TEXT,
  permission TEXT NOT NULL CHECK (permission IN ('admin', 'maintain', 'write', 'triage', 'other')),
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, repo_full_name)
);

-- Members of vendors without a repository, the only members the portal manages.
CREATE TABLE vendor_members (
  owner_id INTEGER NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'publisher', 'translator')),
  added_by INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, user_id)
);

CREATE TABLE plugins (
  plugin_id TEXT PRIMARY KEY,
  repo_id INTEGER,
  repo_full_name TEXT,
  owner_id INTEGER REFERENCES owners (id),
  state TEXT NOT NULL CHECK (state IN ('draft', 'listed', 'delisted')),
  community_translation INTEGER NOT NULL DEFAULT 0,
  community_locales TEXT, -- JSON array, null means every language
  translations_pr INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX plugins_repo ON plugins (repo_id);
CREATE INDEX plugins_owner ON plugins (owner_id);

CREATE TABLE changes (
  id TEXT PRIMARY KEY,
  plugin_id TEXT,
  owner_id INTEGER,
  author_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('self_service', 'reviewed', 'maintainer')),
  entry_json TEXT,
  store_json TEXT,
  state TEXT NOT NULL CHECK (state IN ('draft', 'open', 'merged', 'live', 'rejected', 'withdrawn', 'failed')),
  stage TEXT NOT NULL,
  waiting_on TEXT CHECK (waiting_on IN ('author', 'maintainer', 'system')),
  pr_number INTEGER,
  commit_sha TEXT,
  deployed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX changes_plugin ON changes (plugin_id);
CREATE INDEX changes_author ON changes (author_id);
CREATE INDEX changes_queue ON changes (state, waiting_on, updated_at);

CREATE TABLE change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL REFERENCES changes (id) ON DELETE CASCADE,
  item TEXT,
  stage TEXT NOT NULL,
  actor_id INTEGER,
  detail_json TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX change_events_change ON change_events (change_id, at);

CREATE TABLE notify_prefs (
  user_id INTEGER PRIMARY KEY,
  in_app INTEGER NOT NULL DEFAULT 1,
  email_on_action INTEGER NOT NULL DEFAULT 0,
  email_on_live INTEGER NOT NULL DEFAULT 0,
  email TEXT
);

CREATE TABLE translator_langs (
  user_id INTEGER NOT NULL,
  locale TEXT NOT NULL,
  PRIMARY KEY (user_id, locale)
);

CREATE TABLE store_drafts (
  plugin_id TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  doc_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, author_id)
);

CREATE TABLE media_drafts (
  key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  field TEXT NOT NULL,
  locale TEXT NOT NULL,
  text TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'declined', 'merged')),
  reason TEXT,
  decided_by INTEGER,
  decided_at INTEGER,
  change_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX suggestions_plugin ON suggestions (plugin_id, state);
CREATE INDEX suggestions_author ON suggestions (author_id);

CREATE TABLE ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('anthropic', 'openai')),
  name TEXT NOT NULL,
  base_url TEXT,
  model TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  daily_quota INTEGER NOT NULL DEFAULT 50,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE ai_usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER, -- null for the portal itself
  action TEXT NOT NULL,
  subject TEXT,
  detail_json TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX audit_at ON audit (at);
CREATE INDEX audit_subject ON audit (subject, at);
