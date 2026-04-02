-- Drop old restrictive policies
DROP POLICY IF EXISTS "Users can insert their own captured info" ON public.captured_info;
DROP POLICY IF EXISTS "Users can view their own captured info" ON public.captured_info;
DROP POLICY IF EXISTS "Users can update their own captured info" ON public.captured_info;
DROP POLICY IF EXISTS "Users can delete their own captured info" ON public.captured_info;

-- Allow public access for captured_info (necessary for Demo Mode)
CREATE POLICY "Allow public insert" ON public.captured_info FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public select" ON public.captured_info FOR SELECT USING (true);
CREATE POLICY "Allow public update" ON public.captured_info FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON public.captured_info FOR DELETE USING (true);

-- Drop old restrictive policies for knowledge_nodes
DROP POLICY IF EXISTS "Users can insert their own knowledge nodes" ON public.knowledge_nodes;
DROP POLICY IF EXISTS "Users can view their own knowledge nodes" ON public.knowledge_nodes;
DROP POLICY IF EXISTS "Users can update their own knowledge nodes" ON public.knowledge_nodes;
DROP POLICY IF EXISTS "Users can delete their own knowledge nodes" ON public.knowledge_nodes;

-- Allow public access for knowledge_nodes
CREATE POLICY "Allow public access to knowledge nodes" ON public.knowledge_nodes FOR ALL USING (true) WITH CHECK (true);

-- Drop old restrictive policies for knowledge_links
DROP POLICY IF EXISTS "Users can insert their own knowledge links" ON public.knowledge_links;
DROP POLICY IF EXISTS "Users can view their own knowledge links" ON public.knowledge_links;
DROP POLICY IF EXISTS "Users can update their own knowledge links" ON public.knowledge_links;
DROP POLICY IF EXISTS "Users can delete their own knowledge links" ON public.knowledge_links;

-- Allow public access for knowledge_links
CREATE POLICY "Allow public access to knowledge links" ON public.knowledge_links FOR ALL USING (true) WITH CHECK (true);

-- Make user_id nullable to allow anonymous inserts where auth.uid() is null
ALTER TABLE public.captured_info ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.knowledge_nodes ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.knowledge_links ALTER COLUMN user_id DROP NOT NULL;
