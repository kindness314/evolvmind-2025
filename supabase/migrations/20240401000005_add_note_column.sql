-- Add note column to captured_info table
ALTER TABLE public.captured_info ADD COLUMN IF NOT EXISTS note TEXT;

