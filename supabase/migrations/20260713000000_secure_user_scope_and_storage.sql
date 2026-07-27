-- Restore per-user isolation after the historical shared Demo policies.
-- Demo data is explicitly identified by the fixed fallback scope and is not mixed with authenticated users.

ALTER TABLE public.captured_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert" ON public.captured_info;
DROP POLICY IF EXISTS "Allow public select" ON public.captured_info;
DROP POLICY IF EXISTS "Allow public update" ON public.captured_info;
DROP POLICY IF EXISTS "Allow public delete" ON public.captured_info;
DROP POLICY IF EXISTS "Allow public access to knowledge nodes" ON public.knowledge_nodes;
DROP POLICY IF EXISTS "Allow public access to knowledge links" ON public.knowledge_links;

DROP POLICY IF EXISTS "Users can read own captured info" ON public.captured_info;
DROP POLICY IF EXISTS "Users can write own captured info" ON public.captured_info;
DROP POLICY IF EXISTS "Users can read own knowledge nodes" ON public.knowledge_nodes;
DROP POLICY IF EXISTS "Users can write own knowledge nodes" ON public.knowledge_nodes;
DROP POLICY IF EXISTS "Users can read own knowledge links" ON public.knowledge_links;
DROP POLICY IF EXISTS "Users can write own knowledge links" ON public.knowledge_links;

CREATE POLICY "Users can read own captured info"
  ON public.captured_info FOR SELECT
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY "Users can write own captured info"
  ON public.captured_info FOR ALL
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "Users can read own knowledge nodes"
  ON public.knowledge_nodes FOR SELECT
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY "Users can write own knowledge nodes"
  ON public.knowledge_nodes FOR ALL
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "Users can read own knowledge links"
  ON public.knowledge_links FOR SELECT
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY "Users can write own knowledge links"
  ON public.knowledge_links FOR ALL
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- Demo rows are intentionally shared only when user_id is NULL; authenticated rows never match this branch.
CREATE POLICY "Demo can read captured info"
  ON public.captured_info FOR SELECT TO anon
  USING (user_id IS NULL);
CREATE POLICY "Demo can write captured info"
  ON public.captured_info FOR ALL TO anon
  USING (user_id IS NULL)
  WITH CHECK (user_id IS NULL);
CREATE POLICY "Demo can read knowledge nodes"
  ON public.knowledge_nodes FOR SELECT TO anon
  USING (user_id IS NULL);
CREATE POLICY "Demo can write knowledge nodes"
  ON public.knowledge_nodes FOR ALL TO anon
  USING (user_id IS NULL)
  WITH CHECK (user_id IS NULL);
CREATE POLICY "Demo can read knowledge links"
  ON public.knowledge_links FOR SELECT TO anon
  USING (user_id IS NULL);
CREATE POLICY "Demo can write knowledge links"
  ON public.knowledge_links FOR ALL TO anon
  USING (user_id IS NULL)
  WITH CHECK (user_id IS NULL);

-- Demo access is restricted to rows and objects explicitly marked with the fixed Demo scope.
-- The API may use service credentials for Demo jobs; direct anonymous access remains path-scoped.

UPDATE storage.buckets
SET public = false
WHERE id = 'captured-files';

DROP POLICY IF EXISTS "Allow public upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow public view" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete" ON storage.objects;
DROP POLICY IF EXISTS "Allow public update" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;

CREATE POLICY "Demo can upload captured files"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'captured-files'
    AND (storage.foldername(name))[1] = '00000000-0000-0000-0000-000000000000'
  );
CREATE POLICY "Demo can read captured files"
  ON storage.objects FOR SELECT TO anon
  USING (
    bucket_id = 'captured-files'
    AND (storage.foldername(name))[1] = '00000000-0000-0000-0000-000000000000'
  );
CREATE POLICY "Demo can delete captured files"
  ON storage.objects FOR DELETE TO anon
  USING (
    bucket_id = 'captured-files'
    AND (storage.foldername(name))[1] = '00000000-0000-0000-0000-000000000000'
  );
CREATE POLICY "Users can upload scoped captured files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'captured-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "Users can read scoped captured files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'captured-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "Users can update scoped captured files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'captured-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'captured-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "Users can delete scoped captured files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'captured-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
