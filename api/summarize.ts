/**
 * POST /api/summarize — 近期总结端点
 * 按 7 天或 30 天聚合捕获内容和图谱变化，调用 LLM 生成结构化总结。
 *
 * Mock Input/Output:
 *   Input:  POST { "period": "7d", "scope_id": "00000000-0000-0000-0000-000000000000" }
 *   Output: { "ok": true, "period": "7d", "themes": [...], "importantNodes": [...],
 *             "newConnections": [...], "nextActions": [...], "stats": {...} }
 */
import type { VercelRequest, VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope } from './_lib/requestScope.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';
const MAX_INPUT_CHARS = 6000;

// ---------------------------------------------------------------------------
// JSON 修复（服务端版，复用 ai.ts 的 extractJsonObjects 思路）
// ---------------------------------------------------------------------------

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 修复 LLM 输出 JSON 中字符串值里未转义的 ASCII 引号
 * （例如 MiniMax 常输出 "由"处理中"切换" 这类内嵌引号，会导致 JSON.parse 失败）。
 * 仅在结构上下文之外的裸引号才转义，合法 JSON 不受影响。
 */
function repairUnescapedQuotes(text: string): string {
  const s = (text || '').trim();
  if (!s) return s;
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const next = j >= s.length ? undefined : s[j];
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) {
          out += ch;
          inString = false;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(s[k])) k--;
      const prev = k < 0 ? undefined : s[k];
      if (prev === ':' || prev === ',' || prev === '[' || prev === '{' || prev === undefined) {
        out += ch;
        inString = true;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function extractJsonObjects(text: string): string[] {
  const s = (text || '').trim();
  const results: string[] = [];
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = start; j < s.length; j++) {
      const ch = s[j];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          results.push(s.slice(start, j + 1));
          i = j + 1;
          break;
        }
      }
    }
    if (depth !== 0) break;
  }
  return results;
}

function normalizeContentToJson(text: string): Record<string, unknown> | null {
  const trimmed = (text || '').trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const direct = safeJsonParse(withoutFence) as Record<string, unknown> | null;
  if (direct) return direct;


  const repaired = safeJsonParse(repairUnescapedQuotes(withoutFence)) as Record<string, unknown> | null;
  if (repaired) return repaired;

  const all = extractJsonObjects(withoutFence);
  for (let idx = all.length - 1; idx >= 0; idx--) {
    const parsed = safeJsonParse(all[idx]) as Record<string, unknown> | null;
    if (parsed && (parsed.themes || parsed.importantNodes || parsed.nextActions)) {
      return parsed;
    }
  }
  return null;
}

function stripTrailingV1(url: string): string {
  return url.replace(/\/v1\/?$/, '');
}

// ---------------------------------------------------------------------------
// 确定性聚合（不依赖 LLM）
// ---------------------------------------------------------------------------

interface CapturedRow {
  id: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  created_at: string;
}

interface NodeRow {
  id: string;
  name: string;
  kind: string;
  source_captured_ids: string[];
  created_at: string;
}

interface LinkRow {
  id: string;
  node_id: string;
  linked_node_id: string;
  relation_type: string;
  evidence_captured_ids: string[];
  created_at: string;
  node_name?: string;
  linked_node_name?: string;
}

interface AggregatedData {
  capturedCount: number;
  newNodeCount: number;
  newLinkCount: number;
  tagFreq: Map<string, number>;
  nodeList: { name: string; kind: string; createdAt: string }[];
  linkList: { from: string; to: string; type: string }[];
}

async function aggregateData(
  scopeId: string,
  since: string,
  supabaseKey: string,
): Promise<AggregatedData> {
  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  // 查询 captured_info（含 scope 过滤）
  const capturedUrl = `${baseUrl}/rest/v1/captured_info?select=id,type,title,summary,tags,created_at&created_at=gte.${encodeURIComponent(since)}&scope_id=eq.${encodeURIComponent(scopeId)}&order=created_at.desc&limit=50`;
  const capturedResp = await fetch(capturedUrl, { headers });
  const captured: CapturedRow[] = capturedResp.ok ? (await capturedResp.json()) as CapturedRow[] : [];

  // 查询 knowledge_nodes
  const nodesUrl = `${baseUrl}/rest/v1/knowledge_nodes?select=id,name,kind,source_captured_ids,created_at&scope_id=eq.${encodeURIComponent(scopeId)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=30`;
  const nodesResp = await fetch(nodesUrl, { headers });
  const nodes: NodeRow[] = nodesResp.ok ? (await nodesResp.json()) as NodeRow[] : [];

  // 查询 knowledge_links（通过关联节点限 scope）
  const linksUrl = `${baseUrl}/rest/v1/knowledge_links?select=id,node_id,linked_node_id,relation_type,evidence_captured_ids,created_at,node:node_id(name),linked_node:linked_node_id(name)&created_at=gte.${encodeURIComponent(since)}&limit=40`;
  const linksResp = await fetch(linksUrl, { headers });
  const rawLinks: LinkRow[] = linksResp.ok ? (await linksResp.json()) as LinkRow[] : [];

  // 只保留两端至少一端在 scope 内的链接
  const scopeNodeIds = new Set(nodes.map((n) => n.id));
  const scopeLinks = rawLinks.filter(
    (l) => scopeNodeIds.has(l.node_id) || scopeNodeIds.has(l.linked_node_id),
  );

  // 聚合标签频率
  const tagFreq = new Map<string, number>();
  for (const item of captured) {
    if (Array.isArray(item.tags)) {
      for (const tag of item.tags) {
        if (typeof tag === 'string') {
          tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
        }
      }
    }
  }

  return {
    capturedCount: captured.length,
    newNodeCount: nodes.length,
    newLinkCount: scopeLinks.length,
    tagFreq,
    nodeList: nodes.map((n) => ({
      name: n.name,
      kind: n.kind,
      createdAt: n.created_at,
    })),
    linkList: scopeLinks.map((l) => ({
      from: l.node_name || '未知',
      to: l.linked_node_name || '未知',
      type: l.relation_type,
    })),
  };
}

function buildDeterministicResponse(agg: AggregatedData, period: string) {
  const sortedTags = [...agg.tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const themes = sortedTags.map(([name, count]) => ({ name, count }));
  const importantNodes = agg.nodeList.slice(0, 5).map((n) => ({
    name: n.name,
    kind: n.kind,
    reason: `近期新增${n.kind}`,
  }));
  const newConnections = agg.linkList.slice(0, 5).map((l) => ({
    from: l.from,
    to: l.to,
    relationType: l.type,
  }));
  const nextActions: string[] = [];
  if (agg.capturedCount === 0) {
    nextActions.push('当前没有新捕获的内容，去捕获一些想法吧');
  }
  if (agg.newNodeCount === 0 && agg.capturedCount > 0) {
    nextActions.push('有新的捕获内容但未生成知识节点，检查图谱提取是否运行');
  }

  return {
    ok: true,
    period,
    themes,
    importantNodes,
    newConnections,
    nextActions,
    stats: {
      capturedCount: agg.capturedCount,
      newNodeCount: agg.newNodeCount,
      newLinkCount: agg.newLinkCount,
    },
  };
}

// ---------------------------------------------------------------------------
// LLM 调用
// ---------------------------------------------------------------------------

function formatContextForLLM(agg: AggregatedData): string {
  const parts: string[] = [];

  parts.push(`统计：捕获 ${agg.capturedCount} 条，新节点 ${agg.newNodeCount} 个，新关系 ${agg.newLinkCount} 条`);

  const sortedTags = [...agg.tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (sortedTags.length > 0) {
    parts.push(`高频标签：${sortedTags.map(([t, c]) => `${t}(${c}次)`).join('、')}`);
  }

  if (agg.nodeList.length > 0) {
    const nodeLines = agg.nodeList.slice(0, 10).map((n) => `- ${n.name} [${n.kind}]`);
    parts.push(`新增节点：\n${nodeLines.join('\n')}`);
  }

  if (agg.linkList.length > 0) {
    const linkLines = agg.linkList.slice(0, 10).map((l) => `- ${l.from} → ${l.to} (${l.type})`);
    parts.push(`新增关系：\n${linkLines.join('\n')}`);
  }

  return parts.join('\n\n').slice(0, MAX_INPUT_CHARS);
}

async function callChatCompletion(
  url: string,
  apiKey: string,
  model: string,
  content: string,
) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            '你是知识管理助手。根据提供的近期数据统计，生成结构化总结 JSON。只返回 JSON，不要 Markdown。格式：{"themes":[{"name":"主题","count":3}],"importantNodes":[{"name":"节点","kind":"概念","reason":"新增的核心概念"}],"newConnections":[{"from":"A","to":"B","relationType":"相关"}],"nextActions":["建议1","建议2"]}。每个数组最多 5 项。',
        },
        { role: 'user', content },
      ],
    }),
  });

  const text = await resp.text();
  const json = safeJsonParse(text);
  return { ok: resp.ok, status: resp.status, text, json };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/summarize' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const period = typeof req.body?.period === 'string' ? req.body.period : '';
  if (period !== '7d' && period !== '30d') {
    res.status(400).json({ error: 'Invalid period, must be "7d" or "30d"' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' });
    return;
  }

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

  // 计算 UTC 起止时间
  const now = new Date();
  const days = period === '7d' ? 7 : 30;
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const requestScope = await resolveRequestScope({
      req,
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
    });
    const queryToken = requestScope.accessToken || supabaseKey;
    const agg = await aggregateData(requestScope.scopeId, since, queryToken);

    // 无数据时直接返回空状态
    if (agg.capturedCount === 0 && agg.newNodeCount === 0) {
      const empty = buildDeterministicResponse(agg, period);
      res.status(200).json(empty);
      return;
    }

    // 尝试 LLM
    const apiKey = process.env.MINIMAX_CHAT_API_KEY || process.env.MINIMAX_API_KEY || '';
    if (!apiKey) {
      // 无 API Key: 降级为确定性总结
      const fallback = buildDeterministicResponse(agg, period);
      fallback.nextActions.push('LLM 不可用，当前为统计摘要');
      res.status(200).json(fallback);
      return;
    }

    const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
    const preferredModel = process.env.MINIMAX_MODEL || 'abab6.5s-chat';

    const candidates = [
      preferredModel,
      'MiniMax-M2.5',
      'MiniMax-M2.1',
      'abab6.5s-chat',
    ].filter(Boolean);

    const urlsToTry = [
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      `${stripTrailingV1(baseUrl).replace(/\/$/, '')}/chat/completions`,
    ];

    const context = formatContextForLLM(agg);

    for (const model of candidates) {
      let r: Awaited<ReturnType<typeof callChatCompletion>> | null = null;
      for (const url of urlsToTry) {
        r = await callChatCompletion(url, apiKey, model, context);
        if (!r.ok && r.status === 404) continue;
        break;
      }
      if (!r) continue;
      if (!r.ok) continue;

      const contentStr = r.json && typeof r.json === 'object' && 'choices' in r.json
        ? (r.json as Record<string, unknown>).choices
        : undefined;
      const choices = Array.isArray(contentStr) ? contentStr as Record<string, unknown>[] : [];
      const messageContent = choices[0]?.['message'] as Record<string, unknown> | undefined;
      const text = typeof messageContent?.content === 'string' ? messageContent.content : '';

      const parsed = normalizeContentToJson(text);
      if (parsed) {
        const themes = Array.isArray(parsed.themes)
          ? (parsed.themes as Record<string, unknown>[]).map((t) => ({
              name: typeof t.name === 'string' ? t.name : '',
              count: typeof t.count === 'number' ? t.count : 0,
            }))
          : [];

        const importantNodes = Array.isArray(parsed.importantNodes)
          ? (parsed.importantNodes as Record<string, unknown>[]).map((n) => ({
              name: typeof n.name === 'string' ? n.name : '',
              kind: typeof n.kind === 'string' ? n.kind : '',
              reason: typeof n.reason === 'string' ? n.reason : '',
            }))
          : [];

        const newConnections = Array.isArray(parsed.newConnections)
          ? (parsed.newConnections as Record<string, unknown>[]).map((c) => ({
              from: typeof c.from === 'string' ? c.from : '',
              to: typeof c.to === 'string' ? c.to : '',
              relationType: typeof c.relationType === 'string' ? c.relationType : '相关',
            }))
          : [];

        const nextActions = Array.isArray(parsed.nextActions)
          ? (parsed.nextActions as string[]).filter((a): a is string => typeof a === 'string')
          : [];

        res.status(200).json({
          ok: true,
          period,
          themes: themes.slice(0, 5),
          importantNodes: importantNodes.slice(0, 5),
          newConnections: newConnections.slice(0, 5),
          nextActions: nextActions.slice(0, 5),
          stats: {
            capturedCount: agg.capturedCount,
            newNodeCount: agg.newNodeCount,
            newLinkCount: agg.newLinkCount,
          },
        });
        return;
      }
    }

    // LLM 全部失败 → 确定性降级
    const fallback = buildDeterministicResponse(agg, period);
    res.status(200).json(fallback);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const status = message === 'Authentication required' || message === 'Invalid authentication token' ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Unauthorized' : 'Summarize failed', detail: message });
  }
}
