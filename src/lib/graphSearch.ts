import { getApiAuthHeaders } from './apiAuth';
export interface KnowledgeNodeSearchResult {
  id: string;
  user_id: string | null;
  scope_id: string;
  name: string;
  normalized_name: string;
  kind: string;
  aliases: string[];
  source_captured_ids: string[];
  val: number;
  color: string;
  created_at: string;
  updated_at: string;
  similarity: number;
  /** 确定性匹配原因 */
  matchedReason: string;
  /** 来源摘要片段（最多 2 条） */
  sourcePreviews: string[];
  /** 关联邻居节点名称（最多 3 个） */
  neighborPreviews: string[];
}

export interface KnowledgeNodeSearchResponse {
  ok: boolean;
  query: string;
  results: KnowledgeNodeSearchResult[];
  count: number;
  error?: string;
  detail?: string;
  /** 语义搜索不可用时为 false */
  semanticAvailable?: boolean;
}

export async function semanticSearchKnowledgeNodes(params: {
  query: string;
  userId?: string;
  scopeId?: string;
  threshold?: number;
  count?: number;
}): Promise<KnowledgeNodeSearchResult[]> {
  const { query, threshold = 0.25, count = 20 } = params;
  if (!query.trim()) return [];

  const headers = await getApiAuthHeaders();
  const resp = await fetch('/api/graph/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      threshold,
      count,
      demo: localStorage.getItem('demo_auth') === 'true',
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('知识节点语义搜索失败:', resp.status, errText);
    return [];
  }

  const data: KnowledgeNodeSearchResponse = await resp.json();
  if (!data.semanticAvailable) {
    console.warn('知识节点语义搜索不可用');
  }
  return data.results || [];
}
export async function requestKnowledgeNodeBackfill(batchSize?: number): Promise<{
  ok: boolean;
  processed: number;
  total: number;
  errors?: Array<{ id: string; error: string }>;
}> {
  const headers = await getApiAuthHeaders();
  const resp = await fetch('/api/graph/backfill', {
    method: 'POST',
    headers,
    body: JSON.stringify({ batch_size: batchSize || 10, demo: localStorage.getItem('demo_auth') === 'true' }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`知识节点回填失败: ${resp.status} ${errText}`);
  }

  return resp.json();
}

export function generateEmbeddingForKnowledgeNode(nodeId: string): void {
  getApiAuthHeaders()
    .then((headers) => fetch('/api/graph/embed', {
      method: 'POST',
      headers,
      body: JSON.stringify({ node_id: nodeId, demo: localStorage.getItem('demo_auth') === 'true' }),
    }))
    .catch((e) => {
      console.error('知识节点 embedding 生成失败 (fire-and-forget):', e instanceof Error ? e.message : e);
    });
}
