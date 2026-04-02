-- Add is_pinned column to captured_info table
ALTER TABLE public.captured_info ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
