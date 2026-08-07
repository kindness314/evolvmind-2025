/**
 * POST /api/recommend — 主动推荐端点
 * 基于确定性规则生成推荐，初版不依赖 LLM。
 *
 * 规则：
 *   review   — 近期捕获但尚未关联到知识节点的内容
 *   related  — 共享标签的近期内容
 *   forming  — 近期高频标签（出现 3+ 次）提示可能形成新主题
 *
 * Mock Input/Output:
 *   Input:  POST { "scope_id": "demo-uuid", "dismissed_ids": [] }
 *   Output: { "ok": true, "recommendations": [...] }
 */
import type { VercelRequest, VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope } from './_lib/requestScope.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MAX_RECOMMENDATIONS = 5;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

interface CapturedRow {
  id: string;
  title: string;
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
    const baseUrl = SUPABASE_URL.replace(/\/$/, '');
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${requestScope.accessToken || supabaseKey}`,
    };

    // 查询近期捕获（30 天）
    const capturedScopeFilter = requestScope.isDemo
      ? 'user_id=is.null'
      : `user_id=eq.${encodeURIComponent(scopeId)}`;
    const capturedUrl = `${baseUrl}/rest/v1/captured_info?select=id,title,tags,created_at&${capturedScopeFilter}&order=created_at.desc&limit=40`;
    const capturedResp = await fetch(capturedUrl, { headers });
    if (!capturedResp.ok) {
      const detail = await capturedResp.text();
      throw new Error(`捕获内容查询失败: ${capturedResp.status} ${detail}`);
    }
    const captured: CapturedRow[] = (await capturedResp.json()) as CapturedRow[];
    const nodesScopeFilter = requestScope.isDemo
      ? 'user_id=is.null'
      : `user_id=eq.${encodeURIComponent(scopeId)}`;
    const nodesUrl = `${baseUrl}/rest/v1/knowledge_nodes?select=id,name,kind,source_captured_ids&${nodesScopeFilter}&order=created_at.desc&limit=500`;
    const nodesResp = await fetch(nodesUrl, { headers });
    if (!nodesResp.ok) {
      const detail = await nodesResp.text();
      throw new Error(`知识节点查询失败: ${nodesResp.status} ${detail}`);
    }
    const nodes: NodeRow[] = (await nodesResp.json()) as NodeRow[];

    const linksScopeFilter = requestScope.isDemo
      ? 'user_id=is.null'
      : `user_id=eq.${encodeURIComponent(scopeId)}`;
    const linksUrl = `${baseUrl}/rest/v1/knowledge_links?select=source,target&${linksScopeFilter}&limit=500`;
    const linksResp = await fetch(linksUrl, { headers });
    if (!linksResp.ok) {
      const detail = await linksResp.text();
      throw new Error(`知识链接查询失败: ${linksResp.status} ${detail}`);
    }
    const links: LinkRow[] = (await linksResp.json()) as LinkRow[];

    const recommendations: Array<{
      id: string;
      type: 'review' | 'related' | 'forming';
      title: string;
      reason: string;
      targetType: 'captured' | 'node';
      targetId: string;
      nodeId?: string;
    }> = [];

    // 已关联的 captured ID 集合
    const linkedCapturedIds = new Set<string>();
    for (const node of nodes) {
      if (Array.isArray(node.source_captured_ids)) {
        for (const cid of node.source_captured_ids) {
          if (typeof cid === 'string') linkedCapturedIds.add(cid);
        }
      }
    }

    // --- Rule 1: review — 未关联到知识节点的近期捕获 ---
    for (const item of captured) {
      if (recommendations.length >= MAX_RECOMMENDATIONS) break;
      if (!linkedCapturedIds.has(item.id)) {
        const recId = `review-${item.id}`;
        if (dismissedIds.includes(recId)) continue;
        recommendations.push({
          id: recId,
          type: 'review',
          title: item.title || '未命名内容',
          reason: '尚未关联知识节点，建议回顾整理',
          targetType: 'captured',
          targetId: item.id,
        });
      }
    }

    // --- Rule 2: related — 共享标签的最近两条捕获 ---
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
            reason: `共享标签：${sharedTags.slice(0, 3).join('、')}`,
            targetType: 'captured',
            targetId: a.id,
          });
        }
      }
    }

    // --- Rule 3: forming — 近期高频标签（3+ 次） ---
    if (recommendations.length < MAX_RECOMMENDATIONS) {
      const tagFreq = new Map<string, number>();
      const recentCapture = captured.slice(0, 20);
      for (const item of recentCapture) {
        if (!Array.isArray(item.tags)) continue;
        for (const tag of item.tags) {
          if (typeof tag === 'string') {
            tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
          }
        }
      }
      for (const [tag, freq] of tagFreq) {
        if (recommendations.length >= MAX_RECOMMENDATIONS) break;
        if (freq < 3) continue;
        const recId = `forming-${tag}`;
        if (dismissedIds.includes(recId)) continue;
        // 检查是否有对应知识节点
        const matchingNode = nodes.find((n) =>
          n.name.toLowerCase().includes(tag.toLowerCase()) ||
          n.kind.toLowerCase().includes(tag.toLowerCase()),
        );
        recommendations.push({
          id: recId,
          type: 'forming',
          title: `主题「${tag}」`,
          reason: `近期出现 ${freq} 次，可能正在形成新主题`,
          targetType: matchingNode ? 'node' : 'captured',
          targetId: matchingNode ? matchingNode.id : (recentCapture.find((c) => c.tags.includes(tag))?.id || ''),
          nodeId: matchingNode?.id,
        });
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
