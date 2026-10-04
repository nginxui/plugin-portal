-- What the portal added to the schema after its first release.

-- What the portal sent to apply.yml, when, and the latest outcome it reported.
ALTER TABLE changes ADD COLUMN payload_json TEXT;
ALTER TABLE changes ADD COLUMN dispatched_at INTEGER;
ALTER TABLE changes ADD COLUMN outcome_json TEXT;
