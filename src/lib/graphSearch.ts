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
}

interface KnowledgeNodeSearchResponse {
  ok: boolean;
  query: string;
  results: KnowledgeNodeSearchResult[];
  count: number;
  error?: string;
}

export async function semanticSearchKnowledgeNodes(params: {
  query: string;
  userId?: string;
  scopeId?: string;
  threshold?: number;
  count?: number;
}): Promise<KnowledgeNodeSearchResult[]> {
  const { query, userId, scopeId, threshold = 0.25, count = 20 } = params;
  if (!query.trim()) return [];

  const resp = await fetch('/api/graph/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      user_id: userId || null,
      scope_id: scopeId || null,
      threshold,
      count,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`知识节点语义搜索失败: ${resp.status} ${errText}`);
  }

  const data: KnowledgeNodeSearchResponse = await resp.json();
  return data.results || [];
}

export async function requestKnowledgeNodeBackfill(batchSize?: number): Promise<{
  ok: boolean;
  processed: number;
  total: number;
  errors?: Array<{ id: string; error: string }>;
}> {
  const resp = await fetch('/api/graph/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_size: batchSize || 10 }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`知识节点回填失败: ${resp.status} ${errText}`);
  }

  return resp.json();
}

export function generateEmbeddingForKnowledgeNode(nodeId: string): void {
  fetch('/api/graph/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: nodeId }),
  }).catch((e) => {
    console.error('知识节点 embedding 生成失败 (fire-and-forget):', e.message);
  });
}
