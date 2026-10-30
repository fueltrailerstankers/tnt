-- 0010: M6 stock control, new membership role `factory` (dispatch staff: stock read + dispatch only).
-- Alone in its own migration: a new enum value cannot be used in the transaction that adds it, and 0011 uses it
-- in policies and functions.
alter type public.app_role add value if not exists 'factory';
