-- A short number for each change, shown as "Change #12" and used in its
-- address. The random id stays the key the catalog workflows know.
ALTER TABLE changes ADD COLUMN number INTEGER;
UPDATE changes SET number = (
  SELECT count(*) FROM changes c2
  WHERE c2.created_at < changes.created_at OR (c2.created_at = changes.created_at AND c2.rowid <= changes.rowid)
);
CREATE UNIQUE INDEX changes_number ON changes (number);
