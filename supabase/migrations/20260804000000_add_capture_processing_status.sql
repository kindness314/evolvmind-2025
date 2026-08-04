-- O1: 捕获处理状态追踪
-- 为 captured_info 增加 AI 处理步骤的状态列，让用户在保存后能看到系统做了什么，
-- 失败可见、可重试，且原始内容始终保留（AI 失败不影响原文）。

ALTER TABLE public.captured_info
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS graph_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- 状态取值约定：
--   processing_status: pending | processing | done | error    (整体生命周期)
--   embedding_status:  pending | processing | done | error | skipped
--   graph_status:      pending | processing | done | error | skipped

COMMENT ON COLUMN public.captured_info.processing_status IS '整体处理生命周期：pending|processing|done|error';
COMMENT ON COLUMN public.captured_info.embedding_status IS 'embedding 步骤状态：pending|processing|done|error|skipped';
COMMENT ON COLUMN public.captured_info.graph_status IS '知识图谱构建步骤状态：pending|processing|done|error|skipped';
COMMENT ON COLUMN public.captured_info.processing_error IS '最近一次处理失败的错误信息';

CREATE INDEX IF NOT EXISTS captured_info_processing_status_idx
  ON public.captured_info (processing_status);
