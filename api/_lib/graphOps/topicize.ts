/**
 * POST /api/graph/topicize — 语义主题分类（2026-08-19）
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
 *   Output: { "ok": true, "map": { "a": "工作与职业", "b": "健康与运动" }, "model": "..." }
 *
 * 认证：Demo（X-EvolvMind-Demo 头或 body.demo）或真实 Bearer；匿名 401。
 */
import { randomUUID } from 'node:crypto';
import { resolveRequestScope } from '../requestScope.js';
import { resolveApiKey } from '../apiKey.js';
import { rateLimitOrThrow, sendRateLimited, RATE_LIMIT_ERROR } from '../rateLimit.js';
import type { VercelRequest, VercelResponse } from '../embedding.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

export const maxDuration = 60;

/** 细主题（LLM 归入粒度）——与 src/lib/community.ts SEMANTIC_FINE_TOPICS 保持一致 */
const TOPIC_CATEGORIES = [
  '学习方法', '知识管理', '笔记与整理', '阅读与论文', '复习与记忆', '教育课程',
  '深度工作', '专注力', '时间管理', '效率方法', '会议与沟通', '项目管理', '职业发展', '工作节奏与加班', '写作',
  '睡眠', '运动健身', '饮食营养', '身体保养', '作息习惯',
  '育儿', '喂养与辅食', '家庭关系', '亲子互动',
  '极简生活', '消费观念', '日常安排', '家务与整理', '居家环境',
  '前端开发', '后端开发', '数据库', '部署与运维', 'AI工具', '软件工程',
  '储蓄', '预算', '投资', '收入来源',
  '沟通技巧', '人际关系', '社交活动',
  '情绪管理', '压力与焦虑', '拖延', '习惯与动力', '心理成长',
  '思维方式', '认知效率', '决策', '批判思维', '元认知',
  '宠物', '美食', '旅行', '游戏', '休闲',
  '其他',
] as const;
interface NodeInput {
  id: string;
  name: string;
  aliases?: string[];
}

/** 节点主题的 topic_labels 缓存键：等于 node_id（与簇命名 hash 不冲突） */
function nodeCacheKey(nodeId: string): string {
  return nodeId;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractMessageText(json: unknown): string {
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    const choices = obj.choices;
    if (Array.isArray(choices)) {
      for (const c of choices) {
        const mes = c && typeof c === 'object' ? (c as Record<string, unknown>).message : null;
        const content = mes && typeof mes === 'object' ? (mes as Record<string, unknown>).content : null;
        if (typeof content === 'string') return content;
      }
    }
    const msg = obj.message;
    if (msg && typeof msg === 'object') {
      const content = (msg as Record<string, unknown>).content;
      if (typeof content === 'string') return content;
    }
  }
  return '';
}

async function callChatCompletion(url: string, apiKey: string, model: string, prompt: string): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, text: extractMessageText(json) };
  } catch {
    return { ok: false, text: '' };
  }
}

function buildPrompt(nodes: NodeInput[]): string {
  const rows = nodes.map((n, idx) => `${idx}：${(n.name || '').trim()}${n.aliases?.length ? `（别名：${n.aliases.join('、')}）` : ''}`);
  const cats = TOPIC_CATEGORIES.join('、');
  return (
    `把下面每个知识节点归入最贴切的一个语义主题。只能从这些主题中选：${cats}。` +
    `若都不贴切则归"其他"。\n\n` +
    `严格只输出一个 JSON 对象，键为节点序号，值为主题名。不要输出任何其他文字、\`\`\` 或解释。\n\n节点列表：\n` +
    rows.join('\n')
  );
}

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

  const nodes = (Array.isArray(req.body?.nodes) ? req.body.nodes : []) as NodeInput[];
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

  // 1. 查缓存（topic_labels：cluster_key=node_id, name=category）
  const map: Record<string, string> = {};
  const toGenerate: NodeInput[] = [];
  try {
    const ids = batch.map((n) => n.id);
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/topic_labels?scope_id=eq.${encodeURIComponent(scopeId)}&cluster_key=in.(${ids.join(',')})&select=cluster_key,name&limit=1000`;
    const cacheResp = await fetch(url, { headers });
    if (cacheResp.ok) {
      // 只认"合法细主题"缓存值；旧 12 宽类缓存（粒度升级前）视为未命中 → 重新细分类
      const validNames = new Set<string>(TOPIC_CATEGORIES as readonly string[]);
      const rows = (await cacheResp.json()) as Array<{ cluster_key: string; name: string }>;
      const byName = new Map(rows.map((r) => [r.cluster_key, r.name]));
      for (const n of batch) {
        const stored = byName.get(n.id);
        if (stored && validNames.has(stored)) map[n.id] = stored;
        else toGenerate.push(n);
      }
    } else {
      toGenerate.push(...batch);
    }
  } catch {
    toGenerate.push(...batch);
  }

  // 2. 未命中的 LLM 分类（批量一次调用）
  const valid = new Set<string>(TOPIC_CATEGORIES as readonly string[]);
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M2.5';
  if (toGenerate.length > 0 && apiKey) {
    const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
    const urls = Array.from(
      new Set([`${baseUrl.replace(/\/$/, '')}/chat/completions`, `${baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/chat/completions`]),
    );
    for (const url of urls) {
      const r = await callChatCompletion(url, apiKey, model, buildPrompt(toGenerate));
      if (!r.ok) continue;
      const match = (r.text || '').match(/\{[\s\S]*\}/);
      const parsed = match ? safeJsonParse(match[0]) : null;
      if (!parsed || typeof parsed !== 'object') break;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const node = toGenerate[Number(k)];
        if (node && typeof v === 'string' && valid.has(v)) map[node.id] = v;
      }
      break;
    }
  }

  // 未被 LLM 归类的节点兜底为"其他"，保证每个请求节点都有缓存值（覆盖粒度升级前的陈旧宽类）
  for (const n of batch) {
    if (!map[n.id]) map[n.id] = '其他';
  }

  // 3. 写回：topic_labels 只有 select/insert/delete 策略（无 update），on_conflict 的 UPDATE 会触发 RLS 42501；
  //    故先按 node_id 删旧行（有 DELETE 策略），再 INSERT（有 INSERT 策略）。
  let inserted = 0;
  try {
    const urlBase = SUPABASE_URL.replace(/\/$/, '');
    const ids = batch.map((n) => encodeURIComponent(n.id)).join(',');
    await fetch(`${urlBase}/rest/v1/topic_labels?scope_id=eq.${encodeURIComponent(scopeId)}&cluster_key=in.(${ids})`, {
      method: 'DELETE',
      headers,
    });
    const upserts = batch.map((n) => ({
      id: randomUUID(),
      scope_id: scopeId,
      cluster_key: nodeCacheKey(n.id),
      name: map[n.id],
      description: '',
    }));
    await fetch(`${urlBase}/rest/v1/topic_labels`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(upserts),
    });
    inserted = upserts.length;
  } catch {
    // 缓存写失败不阻塞返回（下次再写）
  }
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
