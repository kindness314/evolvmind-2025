/**
 * api/_lib/graphOps/topicClassify.ts — 语义主题分类共享核心(2026-09-29 从 topicize.ts 抽出)
 * 供 topicize(按需分类)与 topicize-backfill(存量增量回填)共用:
 *   - TOPIC_CATEGORIES 细主题目录(与 src/lib/community.ts SEMANTIC_FINE_TOPICS 一致)
 *   - classifyNodes(): 批量 LLM 分类,返回 nodeId -> category(未归类的兜底"其他")
 *   - writeTopicCache(): 写 topic_labels(cluster_key=node_id);RLS 无 update 策略,先 DELETE 再 INSERT
 */
import { randomUUID } from 'node:crypto';

/** 细主题（LLM 归入粒度）——与 src/lib/community.ts SEMANTIC_FINE_TOPICS 保持一致 */
export const TOPIC_CATEGORIES = [
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

/** 合法细主题查找表（固定目录，静态成员判断用 Record） */
const VALID_TOPIC: Record<string, true> = Object.fromEntries(TOPIC_CATEGORIES.map((c) => [c, true]));

export interface TopicNodeInput {
  id: string;
  name: string;
  aliases?: string[];
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

function buildPrompt(nodes: TopicNodeInput[]): string {
  const rows = nodes.map((n, idx) => `${idx}：${(n.name || '').trim()}${n.aliases?.length ? `（别名：${n.aliases.join('、')}）` : ''}`);
  const cats = TOPIC_CATEGORIES.join('、');
  return (
    `把下面每个知识节点归入最贴切的一个语义主题。只能从这些主题中选：${cats}。` +
    `若都不贴切则归"其他"。\n\n` +
    `严格只输出一个 JSON 对象，键为节点序号，值为主题名。不要输出任何其他文字、\`\`\` 或解释。\n\n节点列表：\n` +
    rows.join('\n')
  );
}

/**
 * 批量 LLM 分类。返回 map: nodeId -> category。
 * LLM 不可用时返回空 map（调用方决定兜底策略）。
 */
export async function classifyNodes(
  nodes: TopicNodeInput[],
  opts: { apiKey: string; model: string; baseUrl: string },
): Promise<{ map: Record<string, string>; model: string }> {
  const map: Record<string, string> = {};
  if (nodes.length === 0 || !opts.apiKey) return { map, model: opts.model };
  const urls = Array.from(
    new Set([`${opts.baseUrl.replace(/\/$/, '')}/chat/completions`, `${opts.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/chat/completions`]),
  );
  for (const url of urls) {
    const r = await callChatCompletion(url, opts.apiKey, opts.model, buildPrompt(nodes));
    if (!r.ok) continue;
    const match = (r.text || '').match(/\{[\s\S]*\}/);
    const parsed = match ? safeJsonParse(match[0]) : null;
    if (!parsed || typeof parsed !== 'object') break;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const node = nodes[Number(k)];
      if (node && typeof v === 'string' && VALID_TOPIC[v]) map[node.id] = v;
    }
    break;
  }
  return { map, model: opts.model };
}

/**
 * 写 topic_labels 缓存（先 DELETE 再 INSERT —— 该表 RLS 无 update 策略，merge 会 42501）。
 * 返回写入行数；失败不抛（下次再写）。
 */
export async function writeTopicCache(params: {
  supabaseUrl: string;
  headers: Record<string, string>;
  scopeId: string;
  nodes: TopicNodeInput[];
  map: Record<string, string>;
}): Promise<number> {
  const { supabaseUrl, headers, scopeId, nodes, map } = params;
  if (nodes.length === 0) return 0;
  try {
    const urlBase = supabaseUrl.replace(/\/$/, '');
    const ids = nodes.map((n) => encodeURIComponent(n.id)).join(',');
    await fetch(`${urlBase}/rest/v1/topic_labels?scope_id=eq.${encodeURIComponent(scopeId)}&cluster_key=in.(${ids})`, {
      method: 'DELETE',
      headers,
    });
    const upserts = nodes.map((n) => ({
      id: randomUUID(),
      scope_id: scopeId,
      cluster_key: n.id,
      name: map[n.id],
      description: '',
    }));
    await fetch(`${urlBase}/rest/v1/topic_labels`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(upserts),
    });
    return upserts.length;
  } catch {
    return 0;
  }
}

/** 查询 scope 内已有"合法细主题"缓存（旧 12 宽类视为未命中） */
export async function queryTopicCache(params: {
  supabaseUrl: string;
  headers: Record<string, string>;
  scopeId: string;
  nodeIds?: string[];
}): Promise<Map<string, string>> {
  const { supabaseUrl, headers, scopeId, nodeIds } = params;
  const out = new Map<string, string>();
  try {
    const urlBase = supabaseUrl.replace(/\/$/, '');
    const idFilter = nodeIds && nodeIds.length > 0 ? `&cluster_key=in.(${nodeIds.join(',')})` : '';
    // 分页拉全(存量可超 1000)
    for (let offset = 0; ; offset += 1000) {
      const resp = await fetch(
        `${urlBase}/rest/v1/topic_labels?scope_id=eq.${encodeURIComponent(scopeId)}${idFilter}&select=cluster_key,name&limit=1000&offset=${offset}`,
        { headers },
      );
      if (!resp.ok) break;
      const rows = (await resp.json()) as Array<{ cluster_key: string; name: string }>;
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const r of rows) {
        if (VALID_TOPIC[r.name]) out.set(r.cluster_key, r.name);
      }
      if (rows.length < 1000) break;
      if (nodeIds) break; // 指定 id 时单页足够
    }
  } catch {
    // 查询失败视为全未命中
  }
  return out;
}
