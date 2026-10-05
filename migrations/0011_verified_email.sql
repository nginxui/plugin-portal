-- Notification mail goes only to an address verified on the user's GitHub
-- account; addresses typed in before were never checked.
UPDATE notify_prefs SET email = NULL WHERE email IS NOT NULL;
