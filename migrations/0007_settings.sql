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
