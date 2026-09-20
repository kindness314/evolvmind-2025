/**
 * POST /api/recommend — 主动推荐端点（深度版）
 *
 * 规则（按优先级）：
 *   1. review      — 近期捕获但尚未关联到知识节点的内容
 *   2. semantic    — 语义相似（embedding 余弦相似）但无共享标签的捕获对
 *   3. graph_bridge — 通过图谱二跳关系关联的捕获（如「加班」→「睡眠不足」→「咖啡」传导链）
 *   4. forming     — 近期升温/新生的主题（标签趋势：近窗 vs 远窗）
 *   5. related     — 共享标签的近期捕获对（低优先级兜底）
 *
 * 深度化：每条推荐带 evidence（引用具体捕获/节点作证）与可执行 action，
 * 理由引用真实数据（次数、趋势方向、传导链），不做模板空话。
 *
 * Mock Input/Output:
 *   Input:  POST { "demo": true, "dismissed_ids": [] }
 *   Output: { "ok": true, "recommendations": [{ "id":"sem-xxx","type":"semantic",
 *             "title":"A ↔ B","reason":"…引用数据…","action":"…可执行…",
 *             "targetType":"captured","targetId":"…","secondaryTargetId":"…",
 *             "evidence":[{"type":"capture","id":"…","title":"…"}] }] }
 */
import type { VercelRequest, VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope } from './_lib/requestScope.js';
import { resolveApiKey } from './_lib/apiKey.js';
import { batchEmbedCaptures, findSimilarPairs, type CapturedForEmbedding, type CapturedWithEmbedding } from './_lib/similarity.js';
import {
  buildGraphIndex,
  computeThemeTrends,
  findGraphBridgePaths,
  findPprBridgePaths,
  findImplicitPairs,
  personalizedPageRank,
  shortestPathNames,
  chainText,
  type CapturedRow,
  type NodeRow,
  type LinkRow,
  type ThemeTrend,
} from './_lib/insights.js';
import { isNoiseCapture, isTrivialNodeName } from './_lib/noise.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.edgefn.net/v1';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2.5';
const MAX_RECOMMENDATIONS = 6;

/** 主题升温窗口：近 7 天 vs 更早 */
const TREND_BOUNDARY_DAYS = 7;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

export interface RecommendationEvidence {
  type: 'capture' | 'node';
  id: string;
  title: string;
}

interface RecommendationItem {
  id: string;
  type: 'review' | 'semantic' | 'graph_bridge' | 'forming' | 'related' | 'knowledge_node' | 'knowledge_topic';
  title: string;
  reason: string;
  action: string;
  targetType: 'captured' | 'node';
  targetId: string;
  nodeId?: string;
  secondaryTargetId?: string;
  /** 证据引用：点开推荐时展示的依据 */
  evidence: RecommendationEvidence[];
}

function safeJsonParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** 从 LLM 文本提取 JSON 数组（容忍 markdown fence / 前后文字） */
function extractJsonArray(text: string): unknown[] | null {
  if (!text) return null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  const parsed = safeJsonParse(slice);
  return Array.isArray(parsed) ? parsed : null;
}

/**
 * 用 LLM 为每条推荐生成更自然的理由（针对该条的具体内容）。
 * 短超时（5s）+ 失败/数量不匹配时保留确定性 reason，避免推荐因 LLM 失败而空白或卡太久。
 */
async function enrichRecommendationReasons(recommendations: RecommendationItem[], apiKey: string): Promise<RecommendationItem[]> {
  if (!apiKey || recommendations.length === 0) return recommendations;
  // 2026-09-19 修复模板腔：原先只传类型+标题，LLM 没有具体素材只能写套话
  // （"把 A 和 B 放在一起看"式）。现在把确定性理由（含相似度/共享标签/天数/传导链等具体数据）
  // 作为素材传入，LLM 只做口语化改写，并明令禁止高频套话。
  // 注：唯一可用的聊天模型 M2.5 是推理型，冷启动 12-30s（实测），超时 30s 是必要的；
  // 超时后保留确定性理由（已按类型优化），推荐不会因改写失败而空白。
  const prompt = [
    `你是知识助手，理解用户记录意图。下面有 ${recommendations.length} 条知识推荐，每条附有一条系统生成的草稿理由（包含具体数据）。请为每条改写为一句自然、贴切、有洞察的中文推荐理由。`,
    `要求：`,
    `- ≤40字，第二人称"你"，每条句式不同，像真人读懂后随口说的`,
    `- 必须保留草稿中的具体事实（数字、标签、天数、中间主题名），禁止丢失`,
    `- 禁止使用这些套话：放在一起看、反复想的是同一件事、值得留意、理清楚、各记各的、回头看也许还有价值`,
    `只输出 JSON 数组，如 ["理由1","理由2",...]，与输入顺序一一对应。`,
    ``,
    ...recommendations.map((r, i) => `【${i}】类型 ${r.type}：${r.title}\n草稿理由：${r.reason}`),
  ].join('\n');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const resp = await fetch(`${MINIMAX_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MINIMAX_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.7 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) { console.error('[enrich] http', resp.status); return recommendations; }
    const text = await resp.text();
    const arr = extractJsonArray(text);
    if (!arr || arr.length !== recommendations.length) { console.error('[enrich] parse/length', arr?.length, text.slice(0, 120)); return recommendations; }
    return recommendations.map((r, i) => ({ ...r, reason: typeof arr[i] === 'string' && arr[i] ? arr[i] : r.reason }));
  } catch (e) {
    console.error('[enrich] exception', e instanceof Error ? e.message : e);
    return recommendations;
  }
}

/** 最近天数文案 */
function daysAgoText(createdAt?: string): string {
  if (!createdAt) return '';
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return '';
  const days = Math.max(0, Math.round((Date.now() - t) / (24 * 3600 * 1000)));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}


// ---------------------------------------------------------------------------
// P5/P6 多信号融合：BM25 关键词信号 + 候选统一打分
// ---------------------------------------------------------------------------

/** 中英文混合 tokenizer：中文按单字+相邻双字，英文按词 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const cjk = text.match(/[\u4e00-\u9fff]/g) || [];
  for (let i = 0; i < cjk.length; i += 1) {
    tokens.push(cjk[i]);
    if (i + 1 < cjk.length) tokens.push(cjk[i] + cjk[i + 1]);
  }
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) || [];
  tokens.push(...words);
  return tokens;
}

/** BM25 得分：query 相对语料中每条文档的加权相关度（k1=1.5, b=0.75） */
function bm25(query: string, docs: string[]): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0 || docs.length === 0) return 0;
  const docTokens = docs.map(tokenize);
  const N = docTokens.length;
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / N;
  const df = new Map<string, number>();
  for (const toks of docTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  }
  const k1 = 1.5;
  const b = 0.75;
  let score = 0;
  const seen = new Set<string>();
  for (const q of qTokens) {
    if (seen.has(q)) continue;
    seen.add(q);
    const docFreq = df.get(q) || 0;
    if (docFreq === 0) continue;
    const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
    for (const toks of docTokens) {
      const tf = toks.filter((t) => t === q).length;
      if (tf === 0) continue;
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (toks.length / avgLen))));
    }
  }
  return score;
}

/** 候选条目：原始推荐 + 三信号分（语义/关键词/图路径）+ 基础分 */
interface ScoredCandidate {
  item: RecommendationItem;
  semantic: number;
  keyword: number;
  graph: number;
  base: number;
}

/** 三信号加权（语义 0.4 / 关键词 0.3 / 图 0.3）+ 基础分 0.3 */
function candidateScore(c: ScoredCandidate): number {
  return 0.4 * c.semantic + 0.3 * c.keyword + 0.3 * c.graph + 0.3 * c.base;
}


/** 分页拉取全部行：PostgREST 默认 max_rows=1000，超出会被静默截断（实测 1027 节点/1570 边只取回 1000） */
async function fetchAllRows(url: string, headers: Record<string, string>): Promise<unknown[]> {
  const PAGE = 1000;
  const rows: unknown[] = [];
  let from = 0;
  for (;;) {
    const resp = await fetch(url, {
      headers: { ...headers, 'Range-Unit': 'items', Range: `${from}-${from + PAGE - 1}` },
    });
    if (!resp.ok) throw new Error(`查询失败: ${resp.status} ${await resp.text()}`);
    const page = (await resp.json()) as unknown[];
    rows.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}
function captureEvidence(c: CapturedRow): RecommendationEvidence {
  return { type: 'capture', id: c.id, title: c.title || '未命名' };
}

function nodeEvidence(n: NodeRow): RecommendationEvidence {
  return { type: 'node', id: n.id, title: n.name };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = resolveApiKey(req);
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/recommend' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' });
    return;
  }

  const dismissedIds: string[] = Array.isArray(req.body?.dismissed_ids)
    ? (req.body.dismissed_ids as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  try {
    const requestScope = await resolveRequestScope({
      req,
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
    });
    const scopeId = requestScope.scopeId;
    const accessToken = requestScope.accessToken || supabaseKey;
    const baseUrl = SUPABASE_URL.replace(/\/$/, '');
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    };

    // 查询近期捕获（30 天窗口，带内容用于 embedding）
    const capturedScopeFilter = requestScope.isDemo
      ? 'user_id=is.null'
      : `user_id=eq.${encodeURIComponent(scopeId)}`;
    const capturedUrl = `${baseUrl}/rest/v1/captured_info?select=id,title,summary,content,tags,created_at&${capturedScopeFilter}&order=created_at.desc&limit=40`;
    const capturedResp = await fetch(capturedUrl, { headers });
    if (!capturedResp.ok) {
      const detail = await capturedResp.text();
      throw new Error(`捕获内容查询失败: ${capturedResp.status} ${detail}`);
    }
    const captured: CapturedRow[] = (await capturedResp.json()) as CapturedRow[];

    // 查询知识节点
    const nodesScopeFilter = requestScope.isDemo
      ? 'user_id=is.null'
      : `user_id=eq.${encodeURIComponent(scopeId)}`;
    // 查询知识节点（分页拉全：PostgREST 默认 max_rows=1000，limit=2000 会被静默截断为 1000）
    const nodesUrl = `${baseUrl}/rest/v1/knowledge_nodes?select=id,name,kind,source_captured_ids,updated_at&${nodesScopeFilter}`;
    const nodes: NodeRow[] = (await fetchAllRows(nodesUrl, headers)) as NodeRow[];

    // 查询知识链接（同样分页拉全）
    const linksUrl = `${baseUrl}/rest/v1/knowledge_links?select=source,target&scope_id=eq.${encodeURIComponent(scopeId)}`;
    const links: LinkRow[] = (await fetchAllRows(linksUrl, headers)) as LinkRow[];

    const graphIndex = buildGraphIndex(nodes, links);

    const signalCaptured = captured.filter(
      (c) => !isNoiseCapture(c.title, c.summary, c.content, c.tags),
    );

    // 捕获 ID → 节点 映射（用于 review 的节点计数与证据）
    const capturedIdToNodes = new Map<string, NodeRow[]>();
    for (const node of nodes) {
      if (!Array.isArray(node.source_captured_ids)) continue;
      for (const cid of node.source_captured_ids) {
        if (typeof cid !== 'string') continue;
        if (!capturedIdToNodes.has(cid)) capturedIdToNodes.set(cid, []);
        capturedIdToNodes.get(cid)!.push(node);
      }
    }

    // --- Step 1: 尝试 embedding（语义分析）---
    let embeddedCaptures: CapturedWithEmbedding[] = [];
    if (apiKey) {
      const forEmbedding: CapturedForEmbedding[] = signalCaptured.slice(0, 20).map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        content: c.content,
        tags: c.tags,
        created_at: c.created_at,
      }));
      embeddedCaptures = await batchEmbedCaptures(forEmbedding, apiKey);
    }

    // P6 BM25 语料：全部信号捕获的标题+内容，作为关键词信号的参照集
    const bm25Corpus = signalCaptured.map((c) => `${c.title || ''} ${c.summary || ''} ${c.content || ''}`.trim());
    const kwSignal = (text: string): number => {
      if (!text) return 0;
      return Math.min(1, bm25(text, bm25Corpus) / 50); // 归一化：50 为经验上限
    };

    // P5 候选池：统一打分（semantic/keyword/graph 三信号 + base）
    const candidates: ScoredCandidate[] = [];
    const dismissedSet = new Set(dismissedIds);
    const clickedSet = new Set<string>(Array.isArray(req.body?.clicked_ids)
      ? (req.body.clicked_ids as unknown[]).filter((id): id is string => typeof id === 'string')
      : []);

    // --- Rule 1: review — 未关联到知识节点的近期捕获 ---
    for (const item of signalCaptured) {
      if (graphIndex.linkedCapturedIds.has(item.id)) continue;
      const recId = `review-${item.id}`;
      // 信号门槛：无标签且正文很短 → 视为碎片/噪声，不上推荐
      const textLen = Math.max((item.content || '').length, (item.summary || '').length);
      const hasSignal = (Array.isArray(item.tags) && item.tags.length > 0) || textLen >= 24;
      if (!hasSignal) continue;
      const nodeCount = capturedIdToNodes.get(item.id)?.length || 0;
      const ago = daysAgoText(item.created_at);
      candidates.push({
        item: {
          id: recId,
          type: 'review',
          title: item.title || '未命名内容',
          reason: `${ago}你记录了「${item.title}」${item.tags?.length ? `（标签：${item.tags.slice(0, 3).join('、')}）` : '（没有标签）'}——这条还没连进你的知识网络，是个悬着的想法`,
          action: nodeCount === 0
            ? item.tags?.length
              ? `给「${item.title}」补一句你现在的想法或结论——有后续的记才会长成知识，没后续的只是备忘`
              : `「${item.title}」还没贴标签也没连成节点——花 1 分钟回忆当时为什么记它，有价值就补一句，没有就删掉`
            : `「${item.title}」你已经想到 ${nodeCount} 处了——回看一下，是不是该把这个想法往前推一步`,
          targetType: 'captured',
          targetId: item.id,
          evidence: [captureEvidence(item)],
        },
        semantic: 0,
        keyword: kwSignal(`${item.title || ''} ${item.summary || ''}`),
        graph: 0,
        base: 0.4,
      });
    }

    // --- Rule 2: semantic — embedding 相似但对（无共享标签，P6 阈值降至 0.55 扩池）---
    if (embeddedCaptures.length >= 2) {
      const similarPairs = findSimilarPairs(embeddedCaptures, {
        minSimilarity: 0.55,
        excludeSharedTags: true,
        maxPairs: 15,
      });
      // 多样性：同一捕获最多参与 1 条语义推荐，避免同一捕获与多个近邻重复刷屏
      const usedCaptures = new Set<string>();
      const diversePairs = similarPairs.filter((pair) => {
        if (usedCaptures.has(pair.a.id) || usedCaptures.has(pair.b.id)) return false;
        usedCaptures.add(pair.a.id);
        usedCaptures.add(pair.b.id);
        return true;
      });

      for (const pair of diversePairs) {
        const recId = `sem-${pair.a.id}-${pair.b.id}`;
        const simPct = Math.round(pair.similarity * 100);
        const aTitle = pair.a.title || '未命名';
        const bTitle = pair.b.title || '未命名';
        const aAgo = daysAgoText(pair.a.created_at);
        const bAgo = daysAgoText(pair.b.created_at);
        const aTags = (pair.a.tags || []).join('、') || '无标签';
        const bTags = (pair.b.tags || []).join('、') || '无标签';
        candidates.push({
          item: {
            id: recId,
            type: 'semantic',
            title: `${aTitle} ↔ ${bTitle}`,
            reason: `「${aTitle}」（${aAgo}，标签：${aTags}）与「${bTitle}」（${bAgo}，标签：${bTags}）词面完全不同，但语义相似度高达 ${simPct}%——两条记录谈的可能是同一件事的不同侧面`,
            action: `重读这两条，用一句话写下它们共同在说什么——这句话就是你这个主题的雏形`,
            targetType: 'captured',
            targetId: pair.a.id,
            secondaryTargetId: pair.b.id,
            evidence: [captureEvidence(pair.a as CapturedRow), captureEvidence(pair.b as CapturedRow)],
          },
          semantic: pair.similarity,
          keyword: kwSignal(`${aTitle} ${bTitle}`),
          graph: 0,
          base: 0.3,
        });
      }
    }

    // --- Rule 3: graph_bridge — P7 Personalized PageRank 传导链 ---
    if (nodes.length > 0) {
      const allBridges = findPprBridgePaths(signalCaptured, graphIndex, MAX_RECOMMENDATIONS * 3);
      // 多样性：同一捕获最多 2 条桥、同一中间节点只推一次，避免 5 条桥全指向同一记录
      const seenMid = new Set<string>();
      const perCapture = new Map<string, number>();
      const bridgePaths: typeof allBridges = [];
      for (const bp of allBridges) {
        const midId = bp.midNode?.id || bp.nodeA.id;
        if (seenMid.has(midId)) continue;
        if ((perCapture.get(bp.captureA.id) || 0) >= 2) continue;
        seenMid.add(midId);
        perCapture.set(bp.captureA.id, (perCapture.get(bp.captureA.id) || 0) + 1);
        bridgePaths.push(bp);
      }
      for (const bp of bridgePaths) {
        const recId = `bridge-${bp.captureA.id}-${bp.captureB.id}`;
        // 传导链两端/中间必须是实质节点，跳过「计划→任务→效率」这类停用词链
        const bridgeNames = [bp.nodeA.name, bp.nodeB.name];
        if (bp.midNode) bridgeNames.push(bp.midNode.name);
        if (bridgeNames.some((n) => isTrivialNodeName(n))) continue;
        const chain = chainText(bp.nodeA.name, bp.midNode?.name || null, bp.nodeB.name);
        candidates.push({
          item: {
            id: recId,
            type: 'graph_bridge',
            title: `${bp.captureA.title} → ${bp.captureB.title}`,
            reason: `你的图谱里存在一条传导链 ${chain}：「${bp.captureA.title}」落在链的一端，「${bp.captureB.title}」落在另一端——两条看起来无关的记录，其实被同一个中间主题串起来了`,
            action: bp.midNode
              ? `顺着「${bp.midNode.name}」这条链补一条中间记录（当时具体发生了什么）——链条就变成可追溯的因果线`
              : `「${bp.nodeA.name}」和「${bp.nodeB.name}」之间可能有你没想到的联系——花一分钟想想，有联系就补一条记录钉住它`,
            targetType: 'captured',
            targetId: bp.captureA.id,
            secondaryTargetId: bp.captureB.id,
            nodeId: (bp.midNode || bp.nodeA).id,
            evidence: [
              captureEvidence(bp.captureA),
              captureEvidence(bp.captureB),
              nodeEvidence(bp.midNode || bp.nodeA),
            ],
          },
          semantic: 0,
          keyword: kwSignal(`${bp.captureA.title || ''} ${bp.captureB.title || ''}`),
          graph: Math.min(1, bp.pprScore * 5),
          base: 0.2,
        });
      }
    }

    // --- Rule 3.5: implicit — 隐含关联预测（图谱结构：共同邻居重叠但未直接连）---
    if (nodes.length > 0 && links.length > 0) {
      const idToName = new Map<string, string>(nodes.map((n) => [n.id, n.name]));
      const nameLinks = links
        .map((l) => ({
          source: idToName.get(l.source) || l.source,
          target: idToName.get(l.target) || l.target,
        }))
        .filter((l) => l.source && l.target);
      const pairs = findImplicitPairs(nodes.map((n) => n.name), nameLinks, { maxPairs: 2 });
      for (const p of pairs) {
        const nodeA = nodes.find((n) => n.name === p.a);
        candidates.push({
          item: {
            id: `implicit-${p.a}-${p.b}`,
            type: 'graph_bridge',
            title: `「${p.a}」↔「${p.b}」`,
            reason: `图谱里「${p.a}」和「${p.b}」连着 ${p.common} 个相同的概念，但你没有把它们直接关联——它们很可能在你心里同属一件事，只是还没被串起来`,
            action: `主动把「${p.a}」和「${p.b}」放在一起想想，这个联结可能是你还没意识到的洞察`,
            targetType: 'node',
            targetId: nodeA?.id || p.a,
            nodeId: nodeA?.id,
            evidence: nodeA ? [nodeEvidence(nodeA)] : [],
          },
          semantic: 0,
          keyword: 0,
          graph: 0.4,
          base: 0.15,
        });
      }
    }

    // --- Rule 4: forming — 近期升温/新生的主题（标签趋势）---
    {
      const trends: ThemeTrend[] = computeThemeTrends(signalCaptured, TREND_BOUNDARY_DAYS, 2);
      // 只看升温与新生的主题；近窗至少出现 2 次才值得推
      const activeTrends = trends.filter((t) => {
        if (t.direction !== 'up' && t.direction !== 'new') return false;
        if (t.recent < 2) return false;
        // 泛化标签（工作/计划/效率…）不构成"正在形成的主题"
        if (isTrivialNodeName(t.name)) return false;
        // 主题必须由有实质内容的捕获支撑（至少 2 条非碎片记录）
        const signalCount = signalCaptured
          .filter((c) => Array.isArray(c.tags) && c.tags.includes(t.name))
          .filter((c) => Math.max((c.content || '').length, (c.summary || '').length) >= 24)
          .length;
        return signalCount >= 2;
      });

      for (const t of activeTrends) {
        const recId = `forming-${t.name}`;
        const matchingNode = nodes.find((n) =>
          n.name.toLowerCase().includes(t.name.toLowerCase()) ||
          n.kind.toLowerCase().includes(t.name.toLowerCase()),
        );
        const tagCaptures = signalCaptured
          .filter((c) => Array.isArray(c.tags) && c.tags.includes(t.name))
          .slice(0, 3);
        const captureExamples = tagCaptures.map((c) => `「${c.title}」`).join('、');
        const trendHint = t.direction === 'new'
          ? `这个话题是最近${TREND_BOUNDARY_DAYS}天新冒出来的，共 ${t.recent} 条`
          : `这个话题正在升温：近${TREND_BOUNDARY_DAYS}天 ${t.recent} 次，而更早只有 ${t.older} 次`;
        candidates.push({
          item: {
            id: recId,
            type: 'forming',
            title: `主题「${t.name}」`,
            reason: `${trendHint}（${captureExamples}）。连续出现说明你可能正在重新关注这件事，值得留意它对你生活的意义`,
            action: matchingNode
              ? `「${t.name}」最近在冒头——回顾这几条新记录，想想是不是生活的某个转折，值得记下背后原因`
              : `「${t.name}」是最近新出现的关注点（${tagCaptures.map((c) => `「${c.title}」`).join('、')}）——像不像你最近在想的事？可以再补充一条，让脉络更清晰`,
            targetType: matchingNode ? 'node' : 'captured',
            targetId: matchingNode ? matchingNode.id : (tagCaptures[0]?.id || ''),
            nodeId: matchingNode?.id,
            evidence: tagCaptures.map(captureEvidence),
          },
          semantic: 0,
          keyword: kwSignal(t.name),
          graph: 0,
          base: 0.6,
        });
      }
    }

    // --- Rule 5: related — 共享标签（兜底，低优先级）---
    {
      const recentCapture = signalCaptured.slice(0, 10);
      for (let i = 0; i < recentCapture.length; i += 1) {
        for (let j = i + 1; j < recentCapture.length; j += 1) {
          const a = recentCapture[i];
          const b = recentCapture[j];
          if (!Array.isArray(a.tags) || !Array.isArray(b.tags)) continue;
          const sharedTags = a.tags.filter((t) => b.tags.includes(t));
          if (sharedTags.length === 0) continue;
          candidates.push({
            item: {
              id: `related-${a.id}-${b.id}`,
              type: 'related',
              title: `${a.title} ↔ ${b.title}`,
              reason: `「${a.title}」（${daysAgoText(a.created_at)}）与「${b.title}」（${daysAgoText(b.created_at)}）共享标签「${sharedTags.slice(0, 3).join('、')}」，可能属于同一主题`,
              action: `给「${sharedTags[0]}」下的记录做一次 5 分钟盘点：哪些已解决、哪些还悬着——悬着的挑一条今天推进`,
              targetType: 'captured',
              targetId: a.id,
              secondaryTargetId: b.id,
              evidence: [captureEvidence(a), captureEvidence(b)],
            },
            semantic: 0,
            keyword: kwSignal(`${a.title || ''} ${b.title || ''}`),
            graph: 0,
            base: 0.2,
          });
        }
      }
    }

    // --- Rule 0: knowledge — 图搜索知识推荐（2026-09-19 用户改向）---
    // 推荐目标是图谱里的知识（节点/小主题），不是记录对：
    // 以近 14 天捕获关联的节点为 PPR 种子，找「与最近思考强相关、但最近没碰」的
    // 休眠节点与小主题；证据链 = 候选到种子的 BFS 最短路径。
    {
      const RECENT_SEED_DAYS = 14;
      const seedCutoff = Date.now() - RECENT_SEED_DAYS * 24 * 3600 * 1000;
      const recentSeeds = signalCaptured.filter((c) => {
        const t = new Date(c.created_at).getTime();
        return Number.isFinite(t) && t >= seedCutoff;
      });
      const seedNodeIds = new Set<string>();
      for (const c of recentSeeds) {
        for (const nid of graphIndex.capturedToNodes.get(c.id) || []) seedNodeIds.add(nid);
      }
      // 活跃节点 = 本窗口（40 条近期捕获）触碰过的节点，推“最近没碰”的就要排除它们
      const activeNodeIds = new Set<string>();
      for (const c of signalCaptured) {
        for (const nid of graphIndex.capturedToNodes.get(c.id) || []) activeNodeIds.add(nid);
      }
      // 近期话题名（标签频率 top3），用于理由文案
      const recentTagFreq = new Map<string, number>();
      for (const c of recentSeeds) for (const t of c.tags || []) recentTagFreq.set(t, (recentTagFreq.get(t) || 0) + 1);
      const hotText = [...recentTagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => `「${t}」`).join('');
      const hotClause = hotText ? `你最近在记${hotText}` : '你最近在持续记录';

      if (seedNodeIds.size > 0) {
        const ppr = personalizedPageRank(graphIndex, [...seedNodeIds]);
        const dormant = [...ppr.entries()]
          .filter(([id, score]) => score > 0 && !activeNodeIds.has(id))
          .map(([id, score]) => ({ node: graphIndex.nodeById.get(id), score }))
          .filter((e): e is { node: NodeRow; score: number } =>
            Boolean(e.node) && !isTrivialNodeName(e.node!.name) && (graphIndex.adj.get(e.node!.id)?.size || 0) >= 1)
          .sort((a, b) => b.score - a.score);
        const maxPpr = dormant[0]?.score || 1;

        // 小主题缓存：topic_labels（cluster_key=node_id, name=细主题），供主题聚合
        const topicMap = new Map<string, string>();
        try {
          const labelUrl = `${baseUrl}/rest/v1/topic_labels?scope_id=eq.${encodeURIComponent(scopeId)}&select=cluster_key,name`;
          const labelRows = (await fetchAllRows(labelUrl, headers)) as Array<{ cluster_key: string; name: string }>;
          for (const r of labelRows) topicMap.set(r.cluster_key, r.name);
        } catch { /* 主题缓存不可用时跳过小主题推荐 */ }

        // 小主题推荐：休眠高分节点按细主题归组（排除「其他」），组内 ≥2 个成员才成题
        const byTopic = new Map<string, { score: number; members: { node: NodeRow; score: number }[] }>();
        for (const { node, score } of dormant.slice(0, 40)) {
          const topic = topicMap.get(node.id);
          if (!topic || topic === '其他') continue;
          if (!byTopic.has(topic)) byTopic.set(topic, { score: 0, members: [] });
        
          const g = byTopic.get(topic)!;
          g.score += score;
          g.members.push({ node, score });
        }
        const topics = [...byTopic.entries()]
          .filter(([, g]) => g.members.length >= 2)
          .sort((a, b) => b[1].score - a[1].score)
          .slice(0, 2);
        const maxTopicScore = topics[0]?.[1].score || 1;
        for (const [topic, g] of topics) {
          const rep = g.members[0].node;
          const names = g.members.slice(0, 3).map((m) => `「${m.node.name}」`).join('、');
          const path = shortestPathNames(graphIndex, rep.id, seedNodeIds);
          // 路径首元素是代表节点自身，文案中已列出成员名，证据链从下一跳开始更顺
          const chainPath = path && path.length > 1 ? path.slice(1) : null;
          const pathText = chainPath ? `经 ${chainPath.map((n) => `「${n}」`).join('→')} 与之相连` : '与之高度相关';
          candidates.push({
            item: {
              id: `ktopic-${topic}`,
              type: 'knowledge_topic',
              title: `主题「${topic}」`,
              reason: `${hotClause}，而「${topic}」这一整块知识（${g.members.length} 个知识点，如 ${names}）${pathText}——这组知识点你最近都没碰过`,
              action: `进入「${topic}」主题挑一个最陌生的知识点重读——它和你最近思考的问题可能有化学反应`,
              targetType: 'node',
              targetId: rep.id,
              nodeId: rep.id,
              evidence: g.members.slice(0, 3).map((m) => nodeEvidence(m.node)),
            },
            semantic: 0,
            keyword: 0,
            graph: g.score / maxTopicScore,
            base: 0.75,
          });
        }

        // 单节点推荐：PPR top 休眠节点
        for (const { node, score } of dormant.slice(0, 4)) {
          const path = shortestPathNames(graphIndex, node.id, seedNodeIds);
          // 路径首元素是候选节点自身（标题已是它），证据链从下一跳开始
          const chainPath = path && path.length > 1 ? path.slice(1) : null;
          const pathText = chainPath ? `经 ${chainPath.map((n) => `「${n}」`).join('→')} 与它们相连` : '与近期话题高度相关';
          const srcCount = node.source_captured_ids?.length || 0;
          const updatedAgo = daysAgoText(node.updated_at || node.created_at || '');
          candidates.push({
            item: {
              id: `knode-${node.id}`,
              type: 'knowledge_node',
              title: node.name,
              reason: `${hotClause}，图谱里的「${node.name}」${pathText}——它关联了 ${srcCount} 条记录${updatedAgo ? `，最近整理是${updatedAgo}` : ''}，也许能给现在的思考提供素材`,
              action: `打开图谱看看「${node.name}」的邻居——给它补一条最近的进展，或写一句它和你当前问题的关系`,
              targetType: 'node',
              targetId: node.id,
              nodeId: node.id,
              evidence: [nodeEvidence(node), ...recentSeeds.slice(0, 2).map(captureEvidence)],
            },
            semantic: 0,
            keyword: 0,
            graph: score / maxPpr,
            base: 0.7,
          });
        }
      }
    }

    // P5 统一打分：三信号加权；dismissed 负权重 -1.0、点击正信号 +0.5
    const scored = candidates
      .map((c) => {
        let score = candidateScore(c);
        if (dismissedSet.has(c.item.id)) score -= 1.0;
        if (clickedSet.has(c.item.id)) score += 0.5;
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score);

    // 类型配额：每种有候选的类型至少保留最高分 1 条（P5 语义对与 forming 不互斥），
    // 其余按分数填充到 MAX_RECOMMENDATIONS
    const typeBest = new Map<string, (typeof scored)[number]>();
    for (const s of scored) {
      if (!typeBest.has(s.item.type)) typeBest.set(s.item.type, s);
    }
    const picked: (typeof scored)[number][] = [];
    const pickedIds = new Set<string>();
    // 降低重复性：每类型最多 2 条（避免某一类（尤其 semantic）刷屏，让推荐类型多样化）
    const MAX_PER_TYPE = 2;
    const typeCount = new Map<string, number>();
    const push = (s: (typeof scored)[number]) => {
      if (picked.length >= MAX_RECOMMENDATIONS) return;
      if (pickedIds.has(s.item.id)) return;
      const t = s.item.type;
      if ((typeCount.get(t) || 0) >= MAX_PER_TYPE) return;
      picked.push(s);
      pickedIds.add(s.item.id);
      typeCount.set(t, (typeCount.get(t) || 0) + 1);
    };
    for (const s of typeBest.values()) push(s);
    for (const s of scored) push(s);

    const pickedRecommendations = picked.slice(0, MAX_RECOMMENDATIONS).map((s) => s.item);

    // 用 LLM 针对性生成更自然的推荐理由（短超时 + 失败保留确定性 reason）
    const recommendations = await enrichRecommendationReasons(pickedRecommendations, apiKey);

    res.status(200).json({
      ok: true,
      recommendations,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const status = message === 'Authentication required' || message === 'Invalid authentication token' ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Unauthorized' : 'Recommend failed', detail: message });
  }
}
