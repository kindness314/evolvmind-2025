-- Drop old restrictive storage policies
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;

-- Allow public access for captured-files bucket (for Demo Mode)
-- 1. Allow everyone to upload (INSERT)
CREATE POLICY "Allow public upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'captured-files');

-- 2. Allow everyone to view (SELECT)
CREATE POLICY "Allow public view" ON storage.objects
  FOR SELECT USING (bucket_id = 'captured-files');

-- 3. Allow everyone to delete (DELETE)
CREATE POLICY "Allow public delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'captured-files');

-- 4. Allow everyone to update (UPDATE)
CREATE POLICY "Allow public update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'captured-files') WITH CHECK (bucket_id = 'captured-files');
