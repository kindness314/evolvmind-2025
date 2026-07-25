/**
 * POST /api/search — 语义搜索端点
 * 生成 query embedding → 调 Supabase RPC match_captured_info → 批量补查摘要 → 返回
 */
import { generateEmbedding, type VercelRequest, type VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope } from './_lib/requestScope.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** 根据相似度返回可读的匹配等级 */
function similarityTier(sim: number): string {
  if (sim >= 0.8) return '高度匹配';
  if (sim >= 0.5) return '中度匹配';
  return '低度匹配';
}

/** 确定命中字段 */
function hitFields(item: Record<string, unknown>): string[] {
  const fields: string[] = [];
  if (item.title) fields.push('标题');
  if (item.content) fields.push('内容');
  if (item.tags) fields.push('标签');
  if (item.summary) fields.push('摘要');
  return fields.length > 0 ? fields : ['内容'];
}

/** 构建确定性 matchedReason（不调用 LLM） */
function buildMatchedReason(item: Record<string, unknown>): string {
  const sim = typeof item.similarity === 'number' ? item.similarity : 0;
  const tier = similarityTier(sim);
  const fields = hitFields(item);
  return `${tier} (${(sim * 100).toFixed(0)}%) — 命中${fields.join('、')}`;
}

interface CapturedInfoRow {
  id: string;
  summary?: string;
  title?: string;
  content?: string;
}

/**
 * 批量查询 captured_info 的摘要（服务端一次 RPC，避免前端 N+1）
 */
async function batchFetchSummaries(
  ids: string[],
  supabaseKey: string,
): Promise<Map<string, CapturedInfoRow>> {
  const map = new Map<string, CapturedInfoRow>();
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

    const rows = (await resp.json()) as CapturedInfoRow[];
    for (const r of rows) {
      map.set(r.id, r);
    }
  } catch {
    // 批量查询失败不影响搜索主流程
  }

  return map;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/search' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.MINIMAX_API_KEY || '';
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

  const matchThreshold = typeof req.body?.threshold === 'number' ? req.body.threshold : 0.3;
  const matchCount = typeof req.body?.count === 'number' ? Math.min(req.body.count, 50) : 20;

  try {
    // 1. 生成查询向量
    const { embedding } = await generateEmbedding({ text: query, apiKey });
    const embeddingStr = `[${embedding.join(',')}]`;

    // 2. 调用 Supabase RPC
    const rpcUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/match_captured_info`;
    const rpcResp = await fetch(rpcUrl, {
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
      }),
    });

    if (!rpcResp.ok) {
      const errText = await rpcResp.text();
      res.status(rpcResp.status).json({ error: 'Supabase RPC error', detail: errText });
      return;
    }

    const rawResults = (await rpcResp.json()) as Record<string, unknown>[];

    // 3. 批量查询摘要
    const ids = rawResults.map((r) => typeof r.id === 'string' ? r.id : '').filter(Boolean);
    const summaryMap = await batchFetchSummaries(ids, requestSupabaseKey);

    // 4. 组装增强结果
    const results = rawResults.map((item) => {
      const id = typeof item.id === 'string' ? item.id : '';
      const info = summaryMap.get(id);
      const sourcePreviews: string[] = [];
      if (info?.summary) sourcePreviews.push(info.summary.slice(0, 120));
      if (info?.title) sourcePreviews.push(info.title.slice(0, 120));

      return {
        ...item,
        matchedReason: buildMatchedReason(item),
        sourcePreviews: sourcePreviews.slice(0, 2),
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
      error: 'Search failed',
      detail: message,
      semanticAvailable: !isEmbeddingError,
    });
  }
}
