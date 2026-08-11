-- 014: M8 Admin Roles

ALTER TABLE public.profiles
ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

-- We don't automatically make anyone an admin;
-- It must be assigned manually through the database.
