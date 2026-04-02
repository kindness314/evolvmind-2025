-- Create captured_info table
CREATE TABLE IF NOT EXISTS public.captured_info (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid(),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    tags TEXT[] DEFAULT '{}',
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for captured_info
ALTER TABLE public.captured_info ENABLE ROW LEVEL SECURITY;

-- Create policies for captured_info
CREATE POLICY "Users can insert their own captured info"
    ON public.captured_info FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own captured info"
    ON public.captured_info FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own captured info"
    ON public.captured_info FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own captured info"
    ON public.captured_info FOR DELETE
    USING (auth.uid() = user_id);

-- Create knowledge_nodes table
CREATE TABLE IF NOT EXISTS public.knowledge_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid(),
    name TEXT NOT NULL,
    val INTEGER DEFAULT 10,
    color TEXT DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for knowledge_nodes
ALTER TABLE public.knowledge_nodes ENABLE ROW LEVEL SECURITY;

-- Create policies for knowledge_nodes
CREATE POLICY "Users can insert their own knowledge nodes"
    ON public.knowledge_nodes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own knowledge nodes"
    ON public.knowledge_nodes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own knowledge nodes"
    ON public.knowledge_nodes FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own knowledge nodes"
    ON public.knowledge_nodes FOR DELETE
    USING (auth.uid() = user_id);

-- Create knowledge_links table
CREATE TABLE IF NOT EXISTS public.knowledge_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid(),
    source UUID REFERENCES public.knowledge_nodes(id) ON DELETE CASCADE,
    target UUID REFERENCES public.knowledge_nodes(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for knowledge_links
ALTER TABLE public.knowledge_links ENABLE ROW LEVEL SECURITY;

-- Create policies for knowledge_links
CREATE POLICY "Users can insert their own knowledge links"
    ON public.knowledge_links FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own knowledge links"
    ON public.knowledge_links FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own knowledge links"
    ON public.knowledge_links FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own knowledge links"
    ON public.knowledge_links FOR DELETE
    USING (auth.uid() = user_id);
