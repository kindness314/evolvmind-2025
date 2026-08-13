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
import { batchEmbedCaptures, findSimilarPairs, type CapturedForEmbedding, type CapturedWithEmbedding } from './_lib/similarity.js';
import {
  buildGraphIndex,
  computeThemeTrends,
  findGraphBridgePaths,
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
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || process.env.MINIMAX_CHAT_API_KEY || '';
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
  type: 'review' | 'semantic' | 'graph_bridge' | 'forming' | 'related';
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
    const nodesUrl = `${baseUrl}/rest/v1/knowledge_nodes?select=id,name,kind,source_captured_ids&${nodesScopeFilter}&limit=2000`;
    const nodesResp = await fetch(nodesUrl, { headers });
    const nodes: NodeRow[] = nodesResp.ok ? (await nodesResp.json()) as NodeRow[] : [];

    // 查询知识链接
    const linksUrl = `${baseUrl}/rest/v1/knowledge_links?select=source,target&scope_id=eq.${encodeURIComponent(scopeId)}&limit=3000`;
    const linksResp = await fetch(linksUrl, { headers });
    const links: LinkRow[] = linksResp.ok ? (await linksResp.json()) as LinkRow[] : [];

    const graphIndex = buildGraphIndex(nodes, links);
    const recommendations: RecommendationItem[] = [];

    // 排除噪声捕获（不参与推荐，避免"天气不错"上桌）
    const signalCaptured = captured.filter(
      (c) => !isNoiseCapture(c.title, c.summary, c.content),
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
    if (MINIMAX_API_KEY) {
      const forEmbedding: CapturedForEmbedding[] = signalCaptured.slice(0, 20).map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        content: c.content,
        tags: c.tags,
        created_at: c.created_at,
      }));
      embeddedCaptures = await batchEmbedCaptures(forEmbedding, MINIMAX_API_KEY);
    }

    // --- Rule 1: review — 未关联到知识节点的近期捕获 ---
    for (const item of signalCaptured) {
      if (recommendations.length >= MAX_RECOMMENDATIONS) break;
      if (graphIndex.linkedCapturedIds.has(item.id)) continue;
      const recId = `review-${item.id}`;
      if (dismissedIds.includes(recId)) continue;
      // 信号门槛：无标签且正文很短 → 视为碎片/噪声，不上推荐
      const textLen = Math.max((item.content || '').length, (item.summary || '').length);
      const hasSignal = (Array.isArray(item.tags) && item.tags.length > 0) || textLen >= 24;
      if (!hasSignal) continue;
      const nodeCount = capturedIdToNodes.get(item.id)?.length || 0;
      const ago = daysAgoText(item.created_at);
      recommendations.push({
        id: recId,
        type: 'review',
        title: item.title || '未命名内容',
        reason: `${ago}你记录了「${item.title}」${item.tags?.length ? `（标签：${item.tags.slice(0, 3).join('、')}）` : '（没有标签）'}，但它还没有生成任何知识节点，其中可能藏着你没意识到的线索`,
        action: nodeCount === 0
          ? '点击打开这条记录，把核心概念补进知识图谱；如果内容与已有主题相关，直接合并而不是新建'
          : '点击打开这条记录，检查它关联的节点是否准确，或手动补上缺失的概念',
        targetType: 'captured',
        targetId: item.id,
        evidence: [captureEvidence(item)],
      });
    }

    // --- Rule 2: semantic — embedding 相似但对（无共享标签）---
    if (recommendations.length < MAX_RECOMMENDATIONS && embeddedCaptures.length >= 2) {
      const similarPairs = findSimilarPairs(embeddedCaptures, {
        minSimilarity: 0.70,
        excludeSharedTags: true,
        maxPairs: MAX_RECOMMENDATIONS,
      });

      for (const pair of similarPairs) {
        if (recommendations.length >= MAX_RECOMMENDATIONS) break;
        const recId = `sem-${pair.a.id}-${pair.b.id}`;
        if (dismissedIds.includes(recId)) continue;
        const simPct = Math.round(pair.similarity * 100);
        const aTitle = pair.a.title || '未命名';
        const bTitle = pair.b.title || '未命名';
        const aAgo = daysAgoText(pair.a.created_at);
        const bAgo = daysAgoText(pair.b.created_at);
        const aTags = (pair.a.tags || []).join('、') || '无标签';
        const bTags = (pair.b.tags || []).join('、') || '无标签';
        recommendations.push({
          id: recId,
          type: 'semantic',
          title: `${aTitle} ↔ ${bTitle}`,
          reason: `「${aTitle}」（${aAgo}，标签：${aTags}）与「${bTitle}」（${bAgo}，标签：${bTags}）词面完全不同，但语义相似度高达 ${simPct}%——你很可能在两次记录中谈论同一件事的两个侧面`,
          action: `对比这两条记录，找到它们共同的底层主题（例如合并成一个知识节点），让分散的观察互相印证`,
          targetType: 'captured',
          targetId: pair.a.id,
          secondaryTargetId: pair.b.id,
          evidence: [captureEvidence(pair.a as CapturedRow), captureEvidence(pair.b as CapturedRow)],
        });
      }
    }

    // --- Rule 3: graph_bridge — 图谱二跳传导链 ---
    if (recommendations.length < MAX_RECOMMENDATIONS && nodes.length > 0) {
      const allBridges = findGraphBridgePaths(signalCaptured, graphIndex, MAX_RECOMMENDATIONS * 3);
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
        if (recommendations.length >= MAX_RECOMMENDATIONS) break;
        const recId = `bridge-${bp.captureA.id}-${bp.captureB.id}`;
        if (dismissedIds.includes(recId)) continue;
      // 传导链两端/中间必须是实质节点，跳过「计划→任务→效率」这类停用词链
      const bridgeNames = [bp.nodeA.name, bp.nodeB.name];
      if (bp.midNode) bridgeNames.push(bp.midNode.name);
      if (bridgeNames.some((n) => isTrivialNodeName(n))) continue;
        const chain = chainText(bp.nodeA.name, bp.midNode?.name || null, bp.nodeB.name);
        recommendations.push({
          id: recId,
          type: 'graph_bridge',
          title: `${bp.captureA.title} → ${bp.captureB.title}`,
          reason: `你的图谱里存在一条传导链 ${chain}：「${bp.captureA.title}」落在链的一端，「${bp.captureB.title}」落在另一端——两条看起来无关的记录，其实被同一个中间主题串起来了`,
          action: bp.midNode
            ? `打开图谱聚焦「${bp.midNode.name}」节点，看看它还在连接哪些内容，这可能是一条你尚未意识到的因果路径`
            : `打开图谱查看「${bp.nodeA.name}」与「${bp.nodeB.name}」的直接关联，评估是否值得深入`,
          targetType: 'captured',
          targetId: bp.captureA.id,
          secondaryTargetId: bp.captureB.id,
          nodeId: (bp.midNode || bp.nodeA).id,
          evidence: [
            captureEvidence(bp.captureA),
            captureEvidence(bp.captureB),
            nodeEvidence(bp.midNode || bp.nodeA),
          ],
        });
      }
    }

    // --- Rule 4: forming — 近期升温/新生的主题（标签趋势）---
    if (recommendations.length < MAX_RECOMMENDATIONS) {
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
        if (recommendations.length >= MAX_RECOMMENDATIONS) break;
        const recId = `forming-${t.name}`;
        if (dismissedIds.includes(recId)) continue;
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
        recommendations.push({
          id: recId,
          type: 'forming',
          title: `主题「${t.name}」`,
          reason: `${trendHint}（${captureExamples}）。连续出现的主题通常意味着你生活中正在发生值得关注的变化`,
          action: matchingNode
            ? `打开图谱深入探索「${t.name}」相关节点，把最近的相关捕获连到它上面，形成完整脉络`
            : `为「${t.name}」建一个知识节点，把 ${tagCaptures.map((c) => `「${c.title}」`).join('、')} 关联起来，后续记录会自然挂靠`,
          targetType: matchingNode ? 'node' : 'captured',
          targetId: matchingNode ? matchingNode.id : (tagCaptures[0]?.id || ''),
          nodeId: matchingNode?.id,
          evidence: tagCaptures.map(captureEvidence),
        });
      }
    }

    // --- Rule 5: related — 共享标签（兜底，低优先级）---
    if (recommendations.length < MAX_RECOMMENDATIONS) {
      const recentCapture = signalCaptured.slice(0, 10);
      for (let i = 0; i < recentCapture.length && recommendations.length < MAX_RECOMMENDATIONS; i++) {
        for (let j = i + 1; j < recentCapture.length && recommendations.length < MAX_RECOMMENDATIONS; j++) {
          const a = recentCapture[i];
          const b = recentCapture[j];
          if (!Array.isArray(a.tags) || !Array.isArray(b.tags)) continue;
          const sharedTags = a.tags.filter((t) => b.tags.includes(t));
          if (sharedTags.length === 0) continue;
          const recId = `related-${a.id}-${b.id}`;
          if (dismissedIds.includes(recId)) continue;
          recommendations.push({
            id: recId,
            type: 'related',
            title: `${a.title} ↔ ${b.title}`,
            reason: `「${a.title}」（${daysAgoText(a.created_at)}）与「${b.title}」（${daysAgoText(b.created_at)}）共享标签「${sharedTags.slice(0, 3).join('、')}」，可能属于同一主题`,
            action: `把这两条记录连起来看：${sharedTags[0]} 是否有一个贯穿始终的主线值得提炼成节点？`,
            targetType: 'captured',
            targetId: a.id,
            secondaryTargetId: b.id,
            evidence: [captureEvidence(a), captureEvidence(b)],
          });
        }
      }
    }

    res.status(200).json({
      ok: true,
      recommendations: recommendations.slice(0, MAX_RECOMMENDATIONS),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const status = message === 'Authentication required' || message === 'Invalid authentication token' ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Unauthorized' : 'Recommend failed', detail: message });
  }
}
