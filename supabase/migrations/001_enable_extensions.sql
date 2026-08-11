-- 001: Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "vector" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pg_trgm" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "moddatetime" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "citext" SCHEMA public;
