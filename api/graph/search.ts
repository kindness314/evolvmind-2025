import { generateEmbedding, type VercelRequest, type VercelResponse } from '../_lib/embedding.js';
import { resolveRequestScope } from '../_lib/requestScope.js';
import { resolveApiKey } from '../_lib/apiKey.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function similarityTier(sim: number): string {
  if (sim >= 0.8) return '高度匹配';
  if (sim >= 0.5) return '中度匹配';
  return '低度匹配';
}

interface CapturedRow {
  id: string;
  summary?: string;
  title?: string;
}

interface LinkRow {
  source: string;
  target: string;
  relation_type: string;
  linked_node_name?: string;
}

async function batchFetchSourcePreviews(
  ids: string[],
  supabaseKey: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;

  try {
    const rpcUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/batch_get_captured_summaries`;
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ p_ids: ids }),
    });
    if (!resp.ok) return map;
    const rows = (await resp.json()) as CapturedRow[];
    for (const r of rows) {
      const previews: string[] = [];
      if (r.summary) previews.push(r.summary.slice(0, 120));
      if (r.title) previews.push(r.title.slice(0, 120));
      map.set(r.id, previews);
    }
  } catch {
    // 降级：不阻塞搜索
  }
  return map;
}

async function batchFetchNeighborPreviews(
  nodeIds: string[],
  supabaseKey: string,
  authorization: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (nodeIds.length === 0) return map;

  try {
    const linksUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/knowledge_links?select=source,target,relation_type,target_node:target(name)&or=(${nodeIds.map((id) => `source.eq.${id}`).join(',')})&limit=20`;
    const resp = await fetch(linksUrl, {
      headers: { apikey: supabaseKey, Authorization: authorization },
    });
    if (!resp.ok) return map;
    const links = (await resp.json()) as Array<LinkRow & { target_node?: { name?: string } }>;
    const byNode = new Map<string, string[]>();
    for (const link of links) {
      const name = link.target_node?.name || '未知节点';
      const existing = byNode.get(link.source) || [];
      if (existing.length < 3) existing.push(name);
      byNode.set(link.source, existing);
    }
    return byNode;
  } catch {
    return map;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/graph/search' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = resolveApiKey(req) || process.env.MINIMAX_API_KEY || '';
  if (!apiKey) {
    res.status(503).json({ error: '语义搜索不可用', detail: 'Missing MINIMAX_API_KEY on server', semanticAvailable: false });
    return;
  }

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !supabaseKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY on server' });
    return;
  }

  let requestScope;
  try {
    requestScope = await resolveRequestScope({ req, supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Authentication required';
    res.status(401).json({ error: message });
    return;
  }

  const requestSupabaseKey = requestScope.accessToken || requestScope.isDemo ? SUPABASE_ANON_KEY : supabaseKey;
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ error: 'Missing query' });
    return;
  }

  const matchThreshold = typeof req.body?.threshold === 'number' ? req.body.threshold : 0.25;
  const matchCount = typeof req.body?.count === 'number' ? Math.min(req.body.count, 50) : 20;

  try {
    const { embedding } = await generateEmbedding({ text: query, apiKey });
    const embeddingStr = `[${embedding.join(',')}]`;

    const rpcResp = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/match_knowledge_nodes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: requestSupabaseKey,
        Authorization: `Bearer ${requestScope.accessToken || requestSupabaseKey}`,
      },
      body: JSON.stringify({
        query_embedding: embeddingStr,
        match_threshold: matchThreshold,
        match_count: matchCount,
        filter_user_id: requestScope.isDemo ? null : requestScope.scopeId,
        filter_scope_id: requestScope.scopeId,
      }),
    });

    if (!rpcResp.ok) {
      const errText = await rpcResp.text();
      res.status(rpcResp.status).json({ error: 'Supabase RPC error', detail: errText });
      return;
    }

    const rawResults = (await rpcResp.json()) as Record<string, unknown>[];

    // 收集所有 source_captured_ids
    const allSourceIds = new Set<string>();
    for (const item of rawResults) {
      const arr = item.source_captured_ids;
      if (Array.isArray(arr)) {
        for (const id of arr) {
          if (typeof id === 'string') allSourceIds.add(id);
        }
      }
    }

    // 批量查询
    const sourcePreviewMap = await batchFetchSourcePreviews(
      [...allSourceIds],
      requestSupabaseKey,
    );
    const neighborMap = await batchFetchNeighborPreviews(
      rawResults.map((r) => typeof r.id === 'string' ? r.id : '').filter(Boolean),
      requestSupabaseKey,
      `Bearer ${requestScope.accessToken || requestSupabaseKey}`,
    );
    // 组装
    const results = rawResults.map((item) => {
      const sim = typeof item.similarity === 'number' ? item.similarity : 0;
      const tier = similarityTier(sim);
      const name = typeof item.name === 'string' ? item.name : '';
      const kind = typeof item.kind === 'string' ? item.kind : '';

      const id = typeof item.id === 'string' ? item.id : '';
      const sourceArr = item.source_captured_ids;
      const sourceIds: string[] = Array.isArray(sourceArr) ? sourceArr.filter((s): s is string => typeof s === 'string') : [];
      const sourcePreviews: string[] = [];
      for (const sid of sourceIds.slice(0, 2)) {
        const previews = sourcePreviewMap.get(sid);
        if (previews && previews.length > 0) sourcePreviews.push(...previews);
      }

      const neighborPreviews = neighborMap.get(id) || [];

      const fields: string[] = [];
      if (name) fields.push('名称');
      const aliases = item.aliases;
      if (Array.isArray(aliases) && aliases.length > 0) fields.push('别名');
      if (kind) fields.push('类型');

      return {
        ...item,
        matchedReason: `${tier} (${(sim * 100).toFixed(0)}%) — 命中${fields.join('、')}`,
        sourcePreviews: sourcePreviews.slice(0, 2),
        neighborPreviews,
      };
    });

    res.status(200).json({
      ok: true,
      query,
      results,
      count: results.length,
      semanticAvailable: true,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const isEmbeddingError = message.includes('embedding') || message.includes('MiniMax');
    res.status(isEmbeddingError ? 503 : 500).json({
      error: 'Graph search failed',
      detail: message,
      semanticAvailable: !isEmbeddingError,
    });
  }
}
