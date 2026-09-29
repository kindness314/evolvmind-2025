/**
 * POST /api/graph/classify-topics — 话题簇模型命名归纳（2026-08-18）
 *
 * 社区检测给出话题簇后，本端点：
 *   1. 按 (scope_id, cluster_key) 查 topic_labels 缓存，命中直接返回（不重复消耗 LLM）
 *   2. 未命中的簇，批量调服务端 LLM 生成 簇名 + 一句话说明
 *   3. 结果写回 topic_labels，返回 map: communityId -> { name, description }
 *
 * Mock Input/Output:
 *   Input:  POST { "demo": true, "clusters": [
 *             { "communityId": 5, "name": "深度工作", "nodeIds": ["a","b","c"],
 *               "memberNames": ["深度工作","番茄钟","专注度"], "kinds": ["concept"] }
 *           ] }
 *   Output: { "ok": true, "labels": { "5": { "name": "专注力与工作法", "description": "..." } }, "model": "..." }
 *
 * 认证：Demo（X-EvolvMind-Demo 头或 body.demo）或真实 Bearer；匿名 401（发布门禁 4）。
 */
import { resolveRequestScope } from '../_lib/requestScope.js';
import { resolveApiKey } from '../_lib/apiKey.js';
import { rateLimitOrThrow, sendRateLimited, RATE_LIMIT_ERROR } from '../_lib/rateLimit.js';
import { createHash, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_lib/embedding.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

export const maxDuration = 60;

interface ClusterInput {
  communityId: number;
  name: string;
  nodeIds: string[];
  memberNames: string[];
  kinds?: string[];
}

/** 簇内容签名：成员 id 排序后拼接，内容确定则 key 稳定（与 LLM 输出无关，防漂移重复调用） */
function clusterKey(cluster: ClusterInput): string {
  return createHash('sha1').update([...cluster.nodeIds].sort().join('|')).digest('hex');
}

function stripTrailingV1(url: string): string {
  return url.replace(/\/v1\/?$/, '');
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface ChatResult {
  ok: boolean;
  status: number;
  text: string;
  json: any;
}

async function callChatCompletion(url: string, apiKey: string, model: string, prompt: string): Promise<ChatResult> {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content:
              '你是个人知识图谱的「话题归纳」助手。用户把知识节点通过社区检测分成了若干簇，' +
              '每个簇是一组紧密相关的主题词。请为每个簇生成一个 2-8 字的中文簇名（概括簇内主题，避免直接用单个节点名）' +
              '和一句 ≤24 字的说明（描述簇的内容主题，供图谱侧边栏展示）。' +
              '只返回严格 JSON：{"clusters":[{"communityId":N,"name":"…","description":"…"}]}，不要 Markdown/解释。',
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text, json: safeJsonParse(text) };
  } finally {
    clearTimeout(timer);
  }
}

/** 从上游递归提取 messages 文本（兼容 chat/completions 结构差异） */
function extractMessageText(json: any): string {
  const choice = json?.choices?.[0];
  if (typeof choice?.message?.content === 'string') return choice.message.content;
  if (typeof choice?.text === 'string') return choice.text;
  return '';
}

function buildPrompt(clusters: ClusterInput[]): string {
  return JSON.stringify(
    clusters.map((c) => ({
      communityId: c.communityId,
      members: c.memberNames.slice(0, 12),
      kinds: c.kinds || [],
    })),
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = resolveApiKey(req);
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/graph/classify-topics', hasKey: Boolean(apiKey) });
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

  const clusters = (Array.isArray(req.body?.clusters) ? req.body.clusters : []) as ClusterInput[];
  if (clusters.length === 0) {
    res.status(400).json({ error: 'Missing clusters' });
    return;
  }

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const accessToken = requestScope.accessToken || undefined;
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || supabaseKey}`,
  };

  // 1. 查缓存：命中直接返回，未命中收集待生成
  const labels: Record<number, { name: string; description: string }> = {};
  const toGenerate: ClusterInput[] = [];
  const keys = clusters.map((c) => ({ communityId: c.communityId, key: clusterKey(c), cluster: c }));

  const scopeId = requestScope.scopeId;
  try {
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/topic_labels?scope_id=eq.${encodeURIComponent(scopeId)}&select=cluster_key,name,description&limit=1000`;
    const cacheResp = await fetch(url, { headers });
    if (cacheResp.ok) {
      const rows = (await cacheResp.json()) as Array<{ cluster_key: string; name: string; description: string }>;
      const byKey = new Map(rows.map((r) => [r.cluster_key, r]));
      for (const { communityId, key, cluster } of keys) {
        const hit = byKey.get(key);
        if (hit) labels[communityId] = { name: hit.name, description: hit.description };
        else toGenerate.push(cluster);
      }
    } else {
      toGenerate.push(...keys.map((k) => k.cluster));
    }
  } catch {
    toGenerate.push(...keys.map((k) => k.cluster));
  }

  // 2. 未命中簇调 LLM 生成（批量一次调用）
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M2.5';
  if (toGenerate.length > 0 && apiKey) {
    const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
    const urls = Array.from(
      new Set([`${baseUrl.replace(/\/$/, '')}/chat/completions`, `${stripTrailingV1(baseUrl).replace(/\/$/, '')}/chat/completions`]),
    );
    for (const url of urls) {
      const r = await callChatCompletion(url, apiKey, model, buildPrompt(toGenerate));
      if (!r.ok || !r.json) continue;
      const text = extractMessageText(r.json);
      // LLM 输出可能带标记/多余文字：从尾部提取合法 JSON 数组
      const match = (text || '').match(/\{[\s\S]*\}/);
      const parsed = match ? safeJsonParse(match[0]) : null;
      const arr = Array.isArray(parsed?.clusters) ? parsed.clusters : [];
      for (const item of arr) {
        if (typeof item?.communityId !== 'number' || typeof item?.name !== 'string') continue;
        labels[item.communityId] = {
          name: item.name.slice(0, 16),
          description: (typeof item?.description === 'string' ? item.description : '').slice(0, 80),
        };
      }
      break; // 成功/失败都只试一轮主 URL
    }
  }

  // 3. 写回缓存（仅成功生成的簇）
  let inserted = 0;
  try {
    const upserts = keys
      .filter(({ communityId }) => labels[communityId] && labels[communityId].name)
      .map(({ communityId, key }) => ({
        id: randomUUID(),
        scope_id: scopeId,
        cluster_key: key,
        name: labels[communityId].name,
        description: labels[communityId].description,
      }));
    if (upserts.length > 0) {
      await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/topic_labels`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(upserts),
      });
      inserted = upserts.length;
    }
  } catch {
    // 缓存写失败不阻塞返回（下次再生成）
  }

  res.status(200).json({
    ok: true,
    labels,
    model,
    generated: toGenerate.length,
    cached: clusters.length - toGenerate.length,
    inserted,
  });
}
