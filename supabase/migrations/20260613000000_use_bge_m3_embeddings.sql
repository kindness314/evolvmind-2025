CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.captured_info
  ADD COLUMN IF NOT EXISTS note text;

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('match_captured_info', 'match_knowledge_nodes')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || fn.signature;
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.captured_info_embedding_idx;
DROP INDEX IF EXISTS public.knowledge_nodes_embedding_idx;

ALTER TABLE public.captured_info
  ALTER COLUMN embedding TYPE vector(1024)
  USING NULL;

ALTER TABLE public.knowledge_nodes
  ALTER COLUMN embedding TYPE vector(1024)
  USING NULL;

CREATE INDEX IF NOT EXISTS captured_info_embedding_idx
  ON public.captured_info
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS knowledge_nodes_embedding_idx
  ON public.knowledge_nodes
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION public.match_captured_info(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20,
  filter_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  type text,
  title text,
  content text,
  tags text[],
  summary text,
  note text,
  is_pinned boolean,
  created_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    ci.id,
    ci.user_id,
    ci.type,
    ci.title,
    ci.content,
    ci.tags,
    ci.summary,
    ci.note,
    ci.is_pinned,
    ci.created_at,
    1 - (ci.embedding <=> query_embedding) AS similarity
  FROM public.captured_info ci
  WHERE
    ci.embedding IS NOT NULL
    AND (filter_user_id IS NULL OR ci.user_id = filter_user_id)
    AND 1 - (ci.embedding <=> query_embedding) > match_threshold
  ORDER BY (ci.embedding <=> query_embedding) ASC
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.match_knowledge_nodes(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20,
  filter_user_id uuid DEFAULT NULL,
  filter_scope_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  scope_id uuid,
  name text,
  normalized_name text,
  kind text,
  aliases text[],
  source_captured_ids uuid[],
  metadata jsonb,
  val int,
  color text,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kn.id,
    kn.user_id,
    kn.scope_id,
    kn.name,
    kn.normalized_name,
    kn.kind,
    kn.aliases,
    kn.source_captured_ids,
    kn.metadata,
    kn.val,
    kn.color,
    kn.created_at,
    kn.updated_at,
    1 - (kn.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_nodes kn
  WHERE
    kn.embedding IS NOT NULL
    AND (filter_user_id IS NULL OR kn.user_id = filter_user_id)
    AND (filter_scope_id IS NULL OR kn.scope_id = filter_scope_id)
    AND 1 - (kn.embedding <=> query_embedding) > match_threshold
  ORDER BY (kn.embedding <=> query_embedding) ASC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_captured_info(vector, float, int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_captured_info(vector, float, int, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_nodes(vector, float, int, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_nodes(vector, float, int, uuid, uuid) TO anon;
