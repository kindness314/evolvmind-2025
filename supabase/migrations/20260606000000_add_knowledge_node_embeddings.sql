CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.knowledge_nodes
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS knowledge_nodes_embedding_idx
  ON public.knowledge_nodes
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION public.match_knowledge_nodes(
  query_embedding vector(1536),
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

GRANT EXECUTE ON FUNCTION public.match_knowledge_nodes TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_nodes TO anon;
