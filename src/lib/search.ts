/**
 * 客户端语义搜索模块
 * dev 模式：直接调 Supabase RPC（需 VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY）
 * prod 模式：调 /api/search 端点
 */
import { supabase } from './supabase';

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
}

export interface SearchResponse {
  ok: boolean;
  query: string;
  results: SearchResult[];
  count: number;
  error?: string;
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
  const { query, userId, threshold = 0.3, count = 20 } = params;
  if (!query.trim()) return [];

  try {
    const resp = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        user_id: userId || null,
        threshold,
        count,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('语义搜索失败:', errText);
      return [];
    }

    const data: SearchResponse = await resp.json();
    return data.results || [];
  } catch (e: any) {
    console.error('语义搜索异常:', e.message);
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
  const resp = await fetch('/api/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_size: batchSize || 10 }),
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
  fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captured_id: capturedId }),
  }).catch((e) => {
    console.error('embedding 生成失败 (fire-and-forget):', e.message);
  });
}
