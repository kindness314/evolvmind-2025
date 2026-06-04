ALTER TABLE public.knowledge_nodes
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'concept',
  ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS source_captured_ids UUID[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.knowledge_nodes
SET normalized_name = lower(trim(name))
WHERE normalized_name IS NULL;

ALTER TABLE public.knowledge_nodes
  ALTER COLUMN normalized_name SET NOT NULL;

ALTER TABLE public.knowledge_nodes
  ADD COLUMN IF NOT EXISTS scope_id UUID GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_scope_norm_uidx
  ON public.knowledge_nodes (scope_id, normalized_name);

ALTER TABLE public.knowledge_links
  ADD COLUMN IF NOT EXISTS relation_type TEXT DEFAULT 'related_to',
  ADD COLUMN IF NOT EXISTS evidence_captured_ids UUID[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.knowledge_links
  ADD COLUMN IF NOT EXISTS scope_id UUID GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_links_scope_dedupe_uidx
  ON public.knowledge_links (scope_id, source, target, relation_type);
