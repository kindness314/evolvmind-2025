-- Create a bucket for captured files
INSERT INTO storage.buckets (id, name, public)
VALUES ('captured-files', 'captured-files', true)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS for the bucket
-- Allow public access to read files
CREATE POLICY "Public Access" ON storage.objects
  FOR SELECT USING (bucket_id = 'captured-files');

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'captured-files' AND
    auth.role() = 'authenticated'
  );

-- Allow users to delete their own files
CREATE POLICY "Users can delete their own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'captured-files' AND
    (auth.uid() = owner OR owner IS NULL)
  );
