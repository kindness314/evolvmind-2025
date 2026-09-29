/**
 * POST /api/graph/topicize-backfill — 存量节点增量话题回填（2026-09-29）
 *
 * 背景：topicize 只在"新节点入库"时分类；存量节点（分类上线前建的、静默失败漏掉的、
 * topic_labels 被清理掉的）一直没有主题，图谱总览全掉进"其他"。
 * 本端点找出当前 scope 内"无合法细主题缓存"的节点，分批 LLM 分类并写回缓存。
 * 幂等：已分类节点自动跳过，可反复调用。
 *
 * Mock Input/Output:
 *   Input:  POST { "demo": true }
 *   Output: { "ok": true, "totalNodes": 980, "missing": 980, "classified": 776, "inserted": 980 }
 *
 * 认证：Demo（X-EvolvMind-Demo 头或 body.demo）或真实 Bearer；匿名 401。限流 3 次/分钟。
 */
import { resolveRequestScope } from '../requestScope.js';
import { resolveApiKey } from '../apiKey.js';
import { rateLimitOrThrow, sendRateLimited, RATE_LIMIT_ERROR } from '../rateLimit.js';
import { classifyNodes, queryTopicCache, writeTopicCache, type TopicNodeInput } from './topicClassify.js';
import type { VercelRequest, VercelResponse } from '../embedding.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = resolveApiKey(req);
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/graph/topicize-backfill', hasKey: Boolean(apiKey) });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  let requestScope;
  try {
    requestScope = await resolveRequestScope({ req, supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : 'Authentication required' });
    return;
  }

  // 限流: 重负载全量回填, 3 次/分钟
  try {
    await rateLimitOrThrow({ req, scope: requestScope, supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, limit: 3 });
  } catch (e) {
    if (e instanceof Error && e.message === RATE_LIMIT_ERROR) { sendRateLimited(res); return; }
    throw e;
  }

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${requestScope.accessToken || supabaseKey}`,
  };
  const scopeId = requestScope.scopeId;
  const urlBase = SUPABASE_URL.replace(/\/$/, '');

  try {
  // 1. 分页拉全 scope 节点（PostgREST 1000 行静默截断，必须分页）
  const allNodes: TopicNodeInput[] = [];
  for (let offset = 0; ; offset += 1000) {
    const resp = await fetch(
      `${urlBase}/rest/v1/knowledge_nodes?scope_id=eq.${encodeURIComponent(scopeId)}&select=id,name,aliases&limit=1000&offset=${offset}`,
      { headers },
    );
    if (!resp.ok) {
      res.status(resp.status).json({ error: 'Supabase query error', detail: await resp.text() });
      return;
    }
    const rows = (await resp.json()) as TopicNodeInput[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    allNodes.push(...rows);
    if (rows.length < 1000) break;
  }

  // 2. 差集：无合法细主题缓存的节点
  const cached = await queryTopicCache({ supabaseUrl: SUPABASE_URL, headers, scopeId });
  const missing = allNodes.filter((n) => !cached.has(n.id));
  if (missing.length === 0) {
    res.status(200).json({ ok: true, totalNodes: allNodes.length, missing: 0, classified: 0, inserted: 0 });
    return;
  }

  // 3. 分批 LLM 分类 + 写回（每批 200，单次部署 60s 上限内控制批数）
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M2.5';
  const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
  let classified = 0;
  let inserted = 0;
  const maxBatches = 10; // 单次最多 2000 节点;更多节点由前端下次再触发(幂等)
  const batches = Math.ceil(missing.length / 200);
  for (let i = 0; i < Math.min(batches, maxBatches); i++) {
    const batch = missing.slice(i * 200, (i + 1) * 200);
    const map: Record<string, string> = {};
    if (apiKey) {
      const r = await classifyNodes(batch, { apiKey, model, baseUrl });
      Object.assign(map, r.map);
    }
    for (const n of batch) {
      if (!map[n.id]) map[n.id] = '其他';
    }
    inserted += await writeTopicCache({ supabaseUrl: SUPABASE_URL, headers, scopeId, nodes: batch, map });
    classified += batch.length;
  }

  res.status(200).json({
    ok: true,
    totalNodes: allNodes.length,
    missing: missing.length,
    classified,
    inserted,
    remaining: missing.length - classified,
    model,
  });
  } catch (e: unknown) {
    // LLM/Supabase 网络抖动不拖垮函数实例，明确 500 由前端下轮再试
    res.status(500).json({ error: 'Backfill failed', detail: e instanceof Error ? e.message : 'Unknown error' });
  }
}
