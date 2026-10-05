-- What the portal added to the schema after its first release.

-- What the portal sent to apply.yml, when, and the latest outcome it reported.
ALTER TABLE changes ADD COLUMN payload_json TEXT;
ALTER TABLE changes ADD COLUMN dispatched_at INTEGER;
ALTER TABLE changes ADD COLUMN outcome_json TEXT;

-- A short number for each change, shown as "Change #12" and used in its
-- address. The random id stays the key the catalog workflows know.
ALTER TABLE changes ADD COLUMN number INTEGER;
CREATE UNIQUE INDEX changes_number ON changes (number);

-- When a user last read their notifications.
ALTER TABLE notify_prefs ADD COLUMN read_at INTEGER;

-- When a user last cleared their notification list.
ALTER TABLE notify_prefs ADD COLUMN cleared_at INTEGER;

-- The interface language a user picked, for the mail the portal sends them.
ALTER TABLE users ADD COLUMN locale TEXT;

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

-- Settings maintainers change on the Settings page. Secrets are sealed with
-- SESSION_KEY; bindings and the root secrets stay in the Worker config.
CREATE TABLE settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER,
  updated_at INTEGER NOT NULL
);

-- News for authors on My plugins, titles and texts by portal language.
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  title_json TEXT NOT NULL,
  text_json TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX announcements_date ON announcements (date DESC);

INSERT INTO announcements (date, title_json, text_json, created_at, updated_at) VALUES
  ('2026-10-04',
   '{"en":"Name changes are reviewed","zh_CN":"名称修改需要审核"}',
   '{"en":"A changed name in any language goes to review before it is listed.","zh_CN":"各语言的插件名称变更都会进入审核。"}',
   strftime('%s', 'now'), strftime('%s', 'now')),
  ('2026-10-05',
   '{"en":"Store texts in every Nginx UI language","zh_CN":"商店资料支持 14 种语言"}',
   '{"en":"Names, descriptions and screenshot captions follow the 14 interface languages of Nginx UI. A language a plugin leaves out shows English.","zh_CN":"与 Nginx UI 界面语言一致，未翻译的语言显示英文。"}',
   strftime('%s', 'now'), strftime('%s', 'now'));

-- GitHub keeps only running totals of downloads, so the daily job writes the
-- total of each plugin down once a day; the difference of two days is that day's
-- downloads.
CREATE TABLE download_snapshots (
  plugin_id TEXT NOT NULL,
  day TEXT NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, day)
);

-- When the catalog first listed each version, from the deploy reports, so an
-- author sees how long a release took to list. A version first seen long
-- after its release, as on the first report, keeps no time.
CREATE TABLE release_listings (
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  listed_at INTEGER,
  PRIMARY KEY (plugin_id, version)
);
