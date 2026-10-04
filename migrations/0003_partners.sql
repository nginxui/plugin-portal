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
