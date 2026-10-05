-- When the catalog first listed each version, from the deploy reports, so an
-- author sees how long a release took to list. A version first seen long
-- after its release, as on the first report, keeps no time.
CREATE TABLE release_listings (
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  listed_at INTEGER,
  PRIMARY KEY (plugin_id, version)
);
