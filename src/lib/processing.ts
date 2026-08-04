/**
 * O1 捕获处理状态 — 客户端状态写入与失败重试
 * 不变量：原始内容先保存；AI 失败不删原文；失败可见；只重试失败步骤。
 */

import { supabase } from './supabase';
import { generateEmbeddingForRow } from './search';
import { buildKnowledgeGraphFromContent, type GraphSetupStatus } from './graph';
import type { ProcessingStatus, StepStatus } from './processingStatus';

export async function updateProcessingFields(params: {
  id: string;
  embedding_status?: StepStatus;
  graph_status?: StepStatus;
  processing_status?: ProcessingStatus;
  processing_error?: string | null;
  processed_at?: string | null;
}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (params.embedding_status !== undefined) body.embedding_status = params.embedding_status;
  if (params.graph_status !== undefined) body.graph_status = params.graph_status;
  if (params.processing_status !== undefined) body.processing_status = params.processing_status;
  if (params.processing_error !== undefined) body.processing_error = params.processing_error;
  if (params.processed_at !== undefined) body.processed_at = params.processed_at;

  const { error } = await supabase
    .from('captured_info')
    .update(body)
    .eq('id', params.id);
  if (error) throw error;
}

/** 重试 embedding：置为 processing，然后 fire-and-forget 重新生成（服务端负责写 done/error） */
export async function retryEmbedding(capturedId: string): Promise<void> {
  await updateProcessingFields({
    id: capturedId,
    embedding_status: 'processing',
    processing_status: 'processing',
    processing_error: null,
  });
  generateEmbeddingForRow(capturedId);
}

/** 校验图谱环境（schema + LLM key），返回可读错误信息 */
export function graphSetupError(setup: GraphSetupStatus): string | null {
  if (!setup.schemaOk) {
    return setup.schemaError?.toLowerCase().includes('invalid api key')
      ? 'Supabase 连接配置错误'
      : '数据库未应用图谱迁移';
  }
  if (!setup.llmOk) return 'LLM 未配置';
  return null;
}

/** 重试知识图谱构建：用该记录的标题/摘要/关键词/原文重新抽取并写库 */
export async function retryGraphBuild(captured: {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
  content: string | null;
}): Promise<void> {
  const contentForGraph =
    captured.type === 'text'
      ? captured.content || ''
      : `标题: ${captured.title}\n摘要: ${captured.summary || ''}\n关键词: ${(captured.tags || []).join(', ')}\n资源: ${captured.content || ''}`;

  await updateProcessingFields({
    id: captured.id,
    graph_status: 'processing',
    processing_status: 'processing',
    processing_error: null,
  });

  try {
    await buildKnowledgeGraphFromContent({ content: contentForGraph, capturedId: captured.id });
    await updateProcessingFields({
      id: captured.id,
      graph_status: 'done',
      processing_status: 'done',
      processed_at: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '图谱构建失败';
    await updateProcessingFields({
      id: captured.id,
      graph_status: 'error',
      processing_status: 'error',
      processing_error: message,
    });
    throw e;
  }
}
