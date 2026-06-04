-- 启用 pgvector 扩展（向量相似度搜索）
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 给 captured_info 添加 embedding 列（1536 维，兼容 MiniMax embo-01 / OpenAI text-embedding-3-small）
ALTER TABLE public.captured_info
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

-- HNSW 索引（适合中小数据集，无需训练，开箱即用）
CREATE INDEX IF NOT EXISTS captured_info_embedding_idx
  ON public.captured_info
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 语义检索 RPC 函数
-- 输入: query_embedding (查询向量), match_threshold (相似度阈值), match_count (返回数量), filter_user_id (用户过滤)
-- 输出: captured_info 所有列 + similarity (0~1 相似度分数)
CREATE OR REPLACE FUNCTION public.match_captured_info(
  query_embedding extensions.vector(1536),
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

-- 授予执行权限（匹配当前 RLS 策略：公开访问）
GRANT EXECUTE ON FUNCTION public.match_captured_info TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_captured_info TO anon;
