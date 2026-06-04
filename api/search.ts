/**
 * POST /api/search — 语义搜索端点
 * 生成 query embedding → 调 Supabase RPC match_captured_info → 返回结果
 */
import { generateEmbedding, type VercelRequest, type VercelResponse } from './_lib/embedding';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
    res.status(500).json({ error: 'Missing MINIMAX_API_KEY on server' });
    return;
  }

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !supabaseKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY on server' });
    return;
  }

  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ error: 'Missing query' });
    return;
  }

  const filterUserId = typeof req.body?.user_id === 'string' ? req.body.user_id : null;
  const matchThreshold = typeof req.body?.threshold === 'number' ? req.body.threshold : 0.3;
  const matchCount = typeof req.body?.count === 'number' ? Math.min(req.body.count, 50) : 20;

  try {
    // 1. 生成查询向量
    const { embedding } = await generateEmbedding({ text: query, apiKey });

    // pgvector 期望字符串格式 "[0.1,0.2,...]"
    const embeddingStr = `[${embedding.join(',')}]`;

    // 2. 调用 Supabase RPC
    const rpcUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/match_captured_info`;
    const rpcResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        query_embedding: embeddingStr,
        match_threshold: matchThreshold,
        match_count: matchCount,
        filter_user_id: filterUserId,
      }),
    });

    if (!rpcResp.ok) {
      const errText = await rpcResp.text();
      res.status(rpcResp.status).json({ error: 'Supabase RPC error', detail: errText });
      return;
    }

    const results = await rpcResp.json();

    res.status(200).json({
      ok: true,
      query,
      results,
      count: Array.isArray(results) ? results.length : 0,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Search failed', detail: e.message });
  }
}
