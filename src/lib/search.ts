/**
 * 客户端语义搜索模块
 * dev 模式：直接调 Supabase RPC（需 VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY）
 * prod 模式：调 /api/search 端点
 */
import { supabase } from './supabase';
import { getApiAuthHeaders } from './apiAuth';

export interface SearchResult {
  id: string;
  user_id: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
  summary: string;
  note: string;
  is_pinned: boolean;
  created_at: string;
  similarity: number;
  /** 确定性匹配原因（相似度区间 + 命中字段） */
  matchedReason: string;
  /** 来源摘要片段（最多 2 条） */
  sourcePreviews: string[];
}

export interface SearchResponse {
  ok: boolean;
  query: string;
  results: SearchResult[];
  count: number;
  error?: string;
  detail?: string;
  /** 语义搜索不可用时为 false */
  semanticAvailable?: boolean;
}

/**
 * 语义搜索 — 通过 /api/search 端点
 */
export async function semanticSearch(params: {
  query: string;
  userId?: string;
  threshold?: number;
  count?: number;
}): Promise<SearchResult[]> {
  const { query, threshold = 0.3, count = 20 } = params;
  if (!query.trim()) return [];

  try {
    const headers = await getApiAuthHeaders();
    const resp = await fetch('/api/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, threshold, count, demo: localStorage.getItem('demo_auth') === 'true' }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('语义搜索失败:', resp.status, errText);
      return [];
    }

    const data: SearchResponse = await resp.json();
    if (!data.semanticAvailable) {
      console.warn('语义搜索不可用，使用本地匹配');
    }
    return data.results || [];
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('语义搜索异常:', message);
    return [];
  }
}

/**
 * 请求回填 embedding — POST /api/backfill
 */
export async function requestBackfill(batchSize?: number): Promise<{
  ok: boolean;
  processed: number;
  total: number;
  errors?: Array<{ id: string; error: string }>;
}> {
  const headers = await getApiAuthHeaders();
  const resp = await fetch('/api/backfill', {
    method: 'POST',
    headers,
    body: JSON.stringify({ batch_size: batchSize || 10, demo: localStorage.getItem('demo_auth') === 'true' }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`回填失败: ${resp.status} ${errText}`);
  }

  return resp.json();
}

/**
 * 为单条记录生成 embedding — POST /api/embed
 * 请求 45s 超时; API 挂起/失败时落 failed 并抛错,
 * 让批量一键处理能串行等待 embedding 完成并正确统计失败项
 */
export function generateEmbeddingForRow(capturedId: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  return getApiAuthHeaders()
    .then((headers) =>
      fetch('/api/embed', {
        method: 'POST',
        headers,
        body: JSON.stringify({ captured_id: capturedId, demo: localStorage.getItem('demo_auth') === 'true' }),
        signal: controller.signal,
      }),
    )
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(`embedding API error: ${resp.status}`);
      }
    })
    .catch((e) => {
      console.error('embedding 生成失败:', e instanceof Error ? e.message : e);
      // 请求超时/失败: 服务端未能回写时, 前端直接落 failed, 让用户看到红并可重试
      return supabase
        .from('captured_info')
        .update({ embedding_status: 'failed', processing_status: 'failed', processing_error: 'embed: 请求超时或失败' })
        .eq('id', capturedId)
        .then(() => {
          throw e instanceof Error ? e : new Error(String(e));
        });
    })
    .finally(() => clearTimeout(timer));
}
