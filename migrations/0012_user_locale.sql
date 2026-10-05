-- The interface language a user picked, for the mail the portal sends them.
ALTER TABLE users ADD COLUMN locale TEXT;
