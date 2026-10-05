-- GitHub keeps only running totals of downloads, so the daily job writes the
-- total of each plugin down once a day; the difference of two days is that day's
-- downloads.
CREATE TABLE download_snapshots (
  plugin_id TEXT NOT NULL,
  day TEXT NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, day)
);
