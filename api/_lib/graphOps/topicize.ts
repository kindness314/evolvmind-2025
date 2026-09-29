/**
 * POST /api/graph/topicize — 语义主题分类（2026-08-19；2026-09-29 核心抽至 topicClassify.ts）
 *
 * 图谱总览层按"语义主题目录"展示（替代模块度碎片社区）。本端点把一批节点
 * 用 LLM 归入固定主题目录，返回 nodeId -> category 映射。
 *
 * 缓存：复用 topic_labels 表（cluster_key = node_id, name = category）。
 * 命中直接返回（不重复消耗 LLM）；未命中 LLM 分类并写回缓存。
 * 复用该表而非新增表：其 RLS 已覆盖 demo(共享 scope)/真实用户(own scope)，无需新迁移。
 *
 * 用"序号索引"让 LLM 返回 { "<idx>": "<category>" }，服务端再映射回 id，
 * 避免 LLM 直接复制 uuid 出错。
 *
 * Mock Input/Output:
 *   Input:  POST { "demo": true, "nodes": [
 *             { "id": "a", "name": "番茄工作法", "aliases": [] },
 *             { "id": "b", "name": "深度睡眠", "aliases": [] }
 *           ] }
 *   Output: { "ok": true, "map": { "a": "学习方法", "b": "睡眠" }, "model": "..." }
 *
 * 认证：Demo（X-EvolvMind-Demo 头或 body.demo）或真实 Bearer；匿名 401。
 */
import { resolveRequestScope } from '../requestScope.js';
import { resolveApiKey } from '../apiKey.js';
import { rateLimitOrThrow, sendRateLimited, RATE_LIMIT_ERROR } from '../rateLimit.js';
import { TOPIC_CATEGORIES, classifyNodes, queryTopicCache, writeTopicCache, type TopicNodeInput } from './topicClassify.js';
import type { VercelRequest, VercelResponse } from '../embedding.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = resolveApiKey(req);
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/graph/topicize', categories: TOPIC_CATEGORIES, hasKey: Boolean(apiKey) });
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

  // 限流(安全审计): 超限 429;RPC 故障放行
  try {
    await rateLimitOrThrow({ req, scope: requestScope, supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, limit: 10 });
  } catch (e) {
    if (e instanceof Error && e.message === RATE_LIMIT_ERROR) { sendRateLimited(res); return; }
    throw e;
  }

  const nodes = (Array.isArray(req.body?.nodes) ? req.body.nodes : []) as TopicNodeInput[];
  if (nodes.length === 0) {
    res.status(400).json({ error: 'Missing nodes' });
    return;
  }
  // 防单次请求过大：一次最多 200 个节点
  const batch = nodes.slice(0, 200);

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const accessToken = requestScope.accessToken || undefined;
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || supabaseKey}`,
  };
  const scopeId = requestScope.scopeId;

  // 1. 查缓存（topic_labels：cluster_key=node_id, name=category）；旧 12 宽类视为未命中
  const cached = await queryTopicCache({ supabaseUrl: SUPABASE_URL, headers, scopeId, nodeIds: batch.map((n) => n.id) });
  const map: Record<string, string> = {};
  const toGenerate: TopicNodeInput[] = [];
  for (const n of batch) {
    const stored = cached.get(n.id);
    if (stored) map[n.id] = stored;
    else toGenerate.push(n);
  }

  // 2. 未命中的 LLM 分类（批量一次调用）
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M2.5';
  if (toGenerate.length > 0 && apiKey) {
    const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
    const r = await classifyNodes(toGenerate, { apiKey, model, baseUrl });
    Object.assign(map, r.map);
  }

  // 未被 LLM 归类的节点兜底为"其他"，保证每个请求节点都有缓存值（覆盖粒度升级前的陈旧宽类）
  for (const n of batch) {
    if (!map[n.id]) map[n.id] = '其他';
  }

  // 3. 写回缓存（先 DELETE 再 INSERT，RLS 无 update 策略）
  const inserted = await writeTopicCache({ supabaseUrl: SUPABASE_URL, headers, scopeId, nodes: batch, map });

  res.status(200).json({
    ok: true,
    map,
    model,
    total: batch.length,
    classified: Object.keys(map).length,
    generated: toGenerate.length,
    inserted,
  });
}
