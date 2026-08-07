-- Add processing status fields to captured_info (O1: 捕获处理状态)
-- 目的: 持久化 AI/embedding/图谱处理状态, 支持失败可见与单步重试
-- 状态枚举: pending | processing | completed | failed
-- 存量数据默认 pending(无处理记录); 后台回填/重试会逐步转为 completed/failed

ALTER TABLE public.captured_info
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS graph_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- 枚举约束, 防止脏状态
ALTER TABLE public.captured_info
  DROP CONSTRAINT IF EXISTS captured_info_processing_status_check,
  ADD CONSTRAINT captured_info_processing_status_check
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed'));

ALTER TABLE public.captured_info
  DROP CONSTRAINT IF EXISTS captured_info_embedding_status_check,
  ADD CONSTRAINT captured_info_embedding_status_check
    CHECK (embedding_status IN ('pending', 'processing', 'completed', 'failed'));

ALTER TABLE public.captured_info
  DROP CONSTRAINT IF EXISTS captured_info_graph_status_check,
  ADD CONSTRAINT captured_info_graph_status_check
    CHECK (graph_status IN ('pending', 'processing', 'completed', 'failed'));

-- RLS: 沿用既有 UPDATE policy (auth.uid() = user_id), 无需新增;
-- Demo 例外沿用 20260713000000_secure_user_scope_and_storage.sql 中的 demo 策略。
