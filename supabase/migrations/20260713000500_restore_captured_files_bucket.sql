-- Ensure the application bucket exists before applying scoped object policies.
-- Older environments may have skipped the original bucket bootstrap migration.
INSERT INTO storage.buckets (id, name, public)
VALUES ('captured-files', 'captured-files', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
