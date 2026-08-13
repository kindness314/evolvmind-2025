/**
 * POST /api/recommend — 主动推荐端点（深度版）
 *
 * 规则（按优先级）：
 *   1. review      — 近期捕获但尚未关联到知识节点的内容
 *   2. semantic    — 语义相似（embedding 余弦相似）但无共享标签的捕获对
 *   3. graph_bridge — 通过图谱二跳关系关联的捕获（如 A→节点X→B）
 *   4. forming     — 近期高频标签（3+ 次）提示可能形成新主题
 *   5. related     — 共享标签的近期捕获对（低优先级兜底）
 *
 * 每条推荐附带具体证据和可执行建议（action）。
 *
 * Mock Input/Output:
 *   Input:  POST { "demo": true, "dismissed_ids": [] }
 *   Output: { "ok": true, "recommendations": [{ "id":"sem-xxx","type":"semantic","title":"A ↔ B","reason":"内容语义高度相似(0.82)但无共享标签","action":"建议对比这两条内容，可能发现隐藏关联","targetType":"captured","targetId":"…","secondaryTargetId":"…" }] }
 */
import type { VercelRequest, VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope } from './_lib/requestScope.js';
import { batchEmbedCaptures, findSimilarPairs, type CapturedForEmbedding, type CapturedWithEmbedding } from './_lib/similarity.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || process.env.MINIMAX_CHAT_API_KEY || '';
const MAX_RECOMMENDATIONS = 6;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

interface CapturedRow {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  created_at: string;
}

interface NodeRow {
  id: string;
  name: string;
  kind: string;
  source_captured_ids: string[];
}

interface LinkRow {
  source: string;
  target: string;
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
}

// ---------------------------------------------------------------------------
// 图谱二跳分析
// ---------------------------------------------------------------------------

/**
 * 构建节点邻接表，查找两个捕获之间的二跳图桥路径：
 * capture A 的节点 → 中间节点 M → capture B 的节点
 */
function findGraphBridgePaths(
  captured: CapturedRow[],
  nodes: NodeRow[],
  links: LinkRow[],
): Array<{
  captureA: CapturedRow;
  captureB: CapturedRow;
  nodeA: NodeRow;
  nodeB: NodeRow;
  midNodeId: string;
}> {
  // 节点 ID → 关联的 captured IDs
  const nodeToCaptured = new Map<string, Set<string>>();
  for (const node of nodes) {
    const set = new Set<string>();
    if (Array.isArray(node.source_captured_ids)) {
      for (const cid of node.source_captured_ids) {
        if (typeof cid === 'string') set.add(cid);
      }
    }
    nodeToCaptured.set(node.id, set);
  }

  // 捕获 ID → 关联的节点 IDs
  const capturedToNodes = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (Array.isArray(node.source_captured_ids)) {
      for (const cid of node.source_captured_ids) {
        if (typeof cid === 'string') {
          if (!capturedToNodes.has(cid)) capturedToNodes.set(cid, new Set());
          capturedToNodes.get(cid)!.add(node.id);
        }
      }
    }
  }

  // 邻接表（无向）
  const adj = new Map<string, Set<string>>();
  for (const link of links) {
    if (!adj.has(link.source)) adj.set(link.source, new Set());
    if (!adj.has(link.target)) adj.set(link.target, new Set());
    adj.get(link.source)!.add(link.target);
    adj.get(link.target)!.add(link.source);
  }

  const capturedSet = new Set(captured.map((c) => c.id));
  const results: Array<{
    captureA: CapturedRow;
    captureB: CapturedRow;
    nodeA: NodeRow;
    nodeB: NodeRow;
    midNodeId: string;
  }> = [];

  for (let i = 0; i < captured.length && results.length < MAX_RECOMMENDATIONS; i++) {
    for (let j = i + 1; j < captured.length && results.length < MAX_RECOMMENDATIONS; j++) {
      const capA = captured[i];
      const capB = captured[j];

      // 跳过已有共享标签的（会被 related 规则捕获）
      const aTags = new Set((capA.tags || []).map((t) => t.toLowerCase()));
      const bTags = (capB.tags || []).map((t) => t.toLowerCase());
      if (bTags.some((t) => aTags.has(t))) continue;

      const nodesA = capturedToNodes.get(capA.id);
      const nodesB = capturedToNodes.get(capB.id);
      if (!nodesA || !nodesB || nodesA.size === 0 || nodesB.size === 0) continue;

      // 查找二跳路径：A的节点 → 中间节点 → B的节点
      let found = false;
      for (const na of nodesA) {
        if (found) break;
        const neighbors = adj.get(na);
        if (!neighbors) continue;
        for (const mid of neighbors) {
          if (found) break;
          // 中间节点不能直接关联 A 或 B
          if (nodeToCaptured.get(mid)?.has(capA.id) || nodeToCaptured.get(mid)?.has(capB.id)) continue;
          for (const nb of nodesB) {
            if (adj.get(mid)?.has(nb)) {
              const nodeAData = nodes.find((n) => n.id === na);
              const nodeBData = nodes.find((n) => n.id === nb);
              if (nodeAData && nodeBData && nodeAData.id !== nodeBData.id) {
                results.push({
                  captureA: capA,
                  captureB: capB,
                  nodeA: nodeAData,
                  nodeB: nodeBData,
                  midNodeId: mid,
                });
                found = true;
                break;
              }
            }
          }
        }
      }
    }
  }

  return results;
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

    // 查询近期捕获（30 天，带内容用于 embedding）
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

    const recommendations: RecommendationItem[] = [];

    // 已关联的 captured ID 集合
    const linkedCapturedIds = new Set<string>();
    for (const node of nodes) {
      if (Array.isArray(node.source_captured_ids)) {
        for (const cid of node.source_captured_ids) {
          if (typeof cid === 'string') linkedCapturedIds.add(cid);
        }
      }
    }

    // 捕获 ID → 节点 映射
    const capturedIdToNodes = new Map<string, NodeRow[]>();
    for (const node of nodes) {
      if (Array.isArray(node.source_captured_ids)) {
        for (const cid of node.source_captured_ids) {
          if (typeof cid === 'string') {
            if (!capturedIdToNodes.has(cid)) capturedIdToNodes.set(cid, []);
            capturedIdToNodes.get(cid)!.push(node);
          }
        }
      }
    }

    // --- Step 1: 尝试 embedding（语义分析）---
    let embeddedCaptures: CapturedWithEmbedding[] = [];
    if (MINIMAX_API_KEY) {
      const forEmbedding: CapturedForEmbedding[] = captured.slice(0, 20).map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        content: c.content,
        tags: c.tags,
      }));
      embeddedCaptures = await batchEmbedCaptures(forEmbedding, MINIMAX_API_KEY);
    }

    // --- Rule 1: review — 未关联到知识节点的近期捕获 ---
    for (const item of captured) {
      if (recommendations.length >= MAX_RECOMMENDATIONS) break;
      if (!linkedCapturedIds.has(item.id)) {
        const recId = `review-${item.id}`;
        if (dismissedIds.includes(recId)) continue;
        const nodeCount = capturedIdToNodes.get(item.id)?.length || 0;
        recommendations.push({
          id: recId,
          type: 'review',
          title: item.title || '未命名内容',
          reason: `"${item.title}"${item.tags?.length ? `（标签：${item.tags.slice(0, 3).join('、')}）` : ''}尚未关联知识节点，内容可能包含未挖掘的洞察`,
          action: '建议回顾并整理这条内容，提取关键概念加入知识图谱',
          targetType: 'captured',
          targetId: item.id,
        });
      }
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
        recommendations.push({
          id: recId,
          type: 'semantic',
          title: `${aTitle} ↔ ${bTitle}`,
          reason: `内容语义高度相似（${simPct}%）但无共享标签——"${aTitle}"与"${bTitle}"可能讨论同一主题的不同侧面`,
          action: `建议对比"${aTitle}"和"${bTitle}"，发现隐藏关联后为它们添加共同标签或知识节点`,
          targetType: 'captured',
          targetId: pair.a.id,
          secondaryTargetId: pair.b.id,
        });
      }
    }

    // --- Rule 3: graph_bridge — 图谱二跳关联 ---
    if (recommendations.length < MAX_RECOMMENDATIONS && nodes.length > 0) {
      const bridgePaths = findGraphBridgePaths(captured, nodes, links);

      for (const bp of bridgePaths) {
        if (recommendations.length >= MAX_RECOMMENDATIONS) break;
        const recId = `bridge-${bp.captureA.id}-${bp.captureB.id}`;
        if (dismissedIds.includes(recId)) continue;
        recommendations.push({
          id: recId,
          type: 'graph_bridge',
          title: `${bp.captureA.title} → ${bp.captureB.title}`,
          reason: `"${bp.captureA.title}"关联的「${bp.nodeA.name}」与"${bp.captureB.title}"关联的「${bp.nodeB.name}」通过图谱二跳路径相连`,
          action: `建议关注"${bp.nodeA.name}"和"${bp.nodeB.name}"之间的联系，可能发现跨领域的深层关系`,
          targetType: 'captured',
          targetId: bp.captureA.id,
          secondaryTargetId: bp.captureB.id,
          nodeId: bp.nodeA.id,
        });
      }
    }

    // --- Rule 4: forming — 近期高频标签（3+ 次）---
    if (recommendations.length < MAX_RECOMMENDATIONS) {
      const tagFreq = new Map<string, { count: number; captures: string[] }>();
      const recentCapture = captured.slice(0, 20);
      for (const item of recentCapture) {
        if (!Array.isArray(item.tags)) continue;
        for (const tag of item.tags) {
          if (typeof tag !== 'string') continue;
          const entry = tagFreq.get(tag) || { count: 0, captures: [] };
          entry.count += 1;
          if (entry.captures.length < 3) entry.captures.push(item.title || '未命名');
          tagFreq.set(tag, entry);
        }
      }

      const sortedTags = [...tagFreq.entries()]
        .filter(([, v]) => v.count >= 3)
        .sort((a, b) => b[1].count - a[1].count);

      for (const [tag, info] of sortedTags) {
        if (recommendations.length >= MAX_RECOMMENDATIONS) break;
        const recId = `forming-${tag}`;
        if (dismissedIds.includes(recId)) continue;
        const matchingNode = nodes.find((n) =>
          n.name.toLowerCase().includes(tag.toLowerCase()) ||
          n.kind.toLowerCase().includes(tag.toLowerCase()),
        );
        const captureExamples = info.captures.map((t) => `"${t}"`).join('、');
        recommendations.push({
          id: recId,
          type: 'forming',
          title: `主题「${tag}」`,
          reason: `近期 ${info.count} 次出现（${captureExamples}），正在形成新主题`,
          action: matchingNode
            ? `建议在知识网络中深入探索「${tag}」相关节点`
            : `建议为「${tag}」创建知识节点，将相关捕获连接起来`,
          targetType: matchingNode ? 'node' : 'captured',
          targetId: matchingNode ? matchingNode.id : (recentCapture.find((c) => c.tags?.includes(tag))?.id || ''),
          nodeId: matchingNode?.id,
        });
      }
    }

    // --- Rule 5: related — 共享标签（兜底，低优先级）---
    if (recommendations.length < MAX_RECOMMENDATIONS) {
      const recentCapture = captured.slice(0, 10);
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
            reason: `共享标签「${sharedTags.slice(0, 3).join('、')}」，可能属于同一主题`,
            action: `建议将"${a.title}"和"${b.title}"的关联发现加入知识图谱`,
            targetType: 'captured',
            targetId: a.id,
            secondaryTargetId: b.id,
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
