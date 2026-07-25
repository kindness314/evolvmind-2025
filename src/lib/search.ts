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
 * 为单条记录生成 embedding — POST /api/embed (fire-and-forget)
 */
export function generateEmbeddingForRow(capturedId: string): void {
  getApiAuthHeaders()
    .then((headers) => fetch('/api/embed', {
      method: 'POST',
      headers,
      body: JSON.stringify({ captured_id: capturedId, demo: localStorage.getItem('demo_auth') === 'true' }),
    }))
    .catch((e) => {
      console.error('embedding 生成失败 (fire-and-forget):', e instanceof Error ? e.message : e);
    });
}
