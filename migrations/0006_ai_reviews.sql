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
