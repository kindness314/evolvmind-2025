/**
 * POST /api/summarize — 近期总结端点（深度版）
 *
 * 产出叙事式总结，帮助用户"认清自己"并指导下一步行动。
 *
 * 流程：
 *   1. 聚合当前周期数据（捕获、节点、关系、标签频率）
 *   2. 查询上一周期数据做趋势对比
 *   3. 提取代表性原文摘录
 *   4. LLM 生成叙事总结（含 narrative + themes + nextActions）
 *   5. LLM 不可用时确定性降级
 *
 * Mock Input/Output:
 *   Input:  POST { "period": "7d", "demo": true }
 *   Output: { "ok": true, "narrative": "这周你...", "themes": [...], "trends": [...], "nextActions": [...] }
 */
import type { VercelRequest, VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope, type RequestScope } from './_lib/requestScope.js';
import { resolveApiKey } from './_lib/apiKey.js';
import { computeThemeDirections, splitByWindow, tagFrequency, computeDepthProfile, findImplicitPairs, type ThemeTrend } from './_lib/insights.js';
import { detectCommunities, evolutionOf, describeCommunity, type Community } from './_lib/community.js';
import { isTrivialNodeName, isNoiseCapture } from './_lib/noise.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

/** P2 社区摘要：一个主题簇的确定性/LLM 摘要块 */
interface CommunityBlock {
  name: string;
  nodeCount: number;
  capturedCount: number;
  /** 近窗新增节点数/记录关联数（演化数据） */
  recentNodes: number;
  recentCaptures: number;
  evolution: 'growing' | 'shrinking' | 'stable';
  /** 确定性描述（describeCommunity）或 LLM 润色的一句话 */
  summary: string;
}
const MAX_INPUT_CHARS = 8000;

// ---------------------------------------------------------------------------
// JSON 修复
// ---------------------------------------------------------------------------

function safeJsonParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function repairUnescapedQuotes(text: string): string {
  let result = '';
  let inString = false;
  let prev = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && prev !== '\\' && !inString) {
      inString = true;
    } else if (ch === '"' && prev !== '\\' && inString) {
      inString = false;
    }
    if (ch === '"' && inString && prev !== '\\') {
      result += '\\"';
    } else {
      result += ch;
    }
    prev = ch;
  }
  return result;
}

function extractJsonObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

function normalizeContentToJson(text: string): Record<string, unknown> | null {
  const objects = extractJsonObjects(text);
  for (const obj of objects.reverse()) {
    const parsed = safeJsonParse(obj) as Record<string, unknown> | null;
    if (parsed && typeof parsed === 'object') return parsed;
  }
  const repaired = repairUnescapedQuotes(text);
  const fixedObjects = extractJsonObjects(repaired);
  for (const obj of fixedObjects.reverse()) {
    const parsed = safeJsonParse(obj) as Record<string, unknown> | null;
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

function stripTrailingV1(url: string): string {
  return url.replace(/\/v1\/?$/, '');
}

// ---------------------------------------------------------------------------
// 数据聚合
// ---------------------------------------------------------------------------

interface CapturedRow {
  id: string;
  type: string;
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
  created_at: string;
}

interface LinkRow {
  id: string;
  source: string;
  target: string;
  relation_type: string;
  evidence_captured_ids: string[];
  created_at: string;
  source_node?: { name: string } | null;
  target_node?: { name: string } | null;
}

interface AggregatedData {
  capturedCount: number;
  /** 捕获查询是否触达 limit=100 上限（真实数量可能更多） */
  capturedCapHit: boolean;
  newNodeCount: number;
  newLinkCount: number;
  tagFreq: Map<string, number>;
  capturedList: { id: string; title: string; summary: string; content: string; tags: string[]; createdAt: string; created_at: string }[];
  nodeList: { name: string; kind: string; createdAt: string; sourceCount: number }[];
  linkList: { from: string; to: string; type: string; evidenceCount: number }[];
  /** 图中心度前5节点（按关联 capture 数） */
  centralNodes: { name: string; kind: string; connectCount: number }[];
  /** 代表性摘录 */
  excerpts: string[];
  /** 原始图谱行（已滤噪声），供社区检测 */
  graphNodes: NodeRow[];
  graphLinks: LinkRow[];
}

/** 分页拉取全部行：PostgREST 默认 max_rows=1000，limit=100/200 会被静默截断（实测 30d 窗口 120 捕获/907 节点只取回 100） */
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

async function aggregateData(
  scope: RequestScope,
  since: string,
  supabaseKey: string,
): Promise<AggregatedData> {
  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  const capturedFilter = scope.isDemo ? 'user_id=is.null' : `user_id=eq.${encodeURIComponent(scope.scopeId)}`;
  const capturedUrl = `${baseUrl}/rest/v1/captured_info?select=id,type,title,summary,content,tags,created_at&created_at=gte.${encodeURIComponent(since)}&${capturedFilter}&order=created_at.desc`;
  const captured: CapturedRow[] = (await fetchAllRows(capturedUrl, headers)) as CapturedRow[];

  const nodesUrl = `${baseUrl}/rest/v1/knowledge_nodes?select=id,name,kind,source_captured_ids,created_at&scope_id=eq.${encodeURIComponent(scope.scopeId)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`;
  const nodes: NodeRow[] = (await fetchAllRows(nodesUrl, headers)) as NodeRow[];

  const linksUrl = `${baseUrl}/rest/v1/knowledge_links?select=id,source,target,relation_type,evidence_captured_ids,created_at,source_node:knowledge_nodes!knowledge_links_source_fkey(name),target_node:knowledge_nodes!knowledge_links_target_fkey(name)&scope_id=eq.${encodeURIComponent(scope.scopeId)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`;
  const rawLinks: LinkRow[] = (await fetchAllRows(linksUrl, headers)) as LinkRow[];

  const scopeNodeIds = new Set(nodes.map((n) => n.id));
  const scopeLinks = rawLinks.filter(
    (l) => scopeNodeIds.has(l.source) || scopeNodeIds.has(l.target),
  );

  // 标签频率
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

  // 图中心度：按关联 source_captured_ids 数排序，排除噪声节点
  const centralNodes = nodes
    .map((n) => ({
      name: n.name,
      kind: n.kind,
      connectCount: (Array.isArray(n.source_captured_ids) ? n.source_captured_ids.length : 0),
    }))
    .filter((n) => n.connectCount > 0)
    .filter((n) => !isTrivialNodeName(n.name))
    .sort((a, b) => b.connectCount - a.connectCount)
    .slice(0, 5);


  // 代表性摘录：排除噪声捕获，取有实质内容的，选前3条
  const excerpts = captured
    .filter((c) => !isNoiseCapture(c.title, c.summary, c.content, c.tags))
    .filter((c) => c.summary || c.content)
    .slice(0, 3)
    .map((c) => {
      const text = (c.summary || c.content || '').slice(0, 120);
      return text ? `「${c.title || '未命名'}」${text}${text.length >= 120 ? '...' : ''}` : '';
    })
    .filter(Boolean);

  return {
    capturedCount: captured.length,
    capturedCapHit: captured.length >= 100,
    newNodeCount: nodes.length,
    newLinkCount: scopeLinks.length,
    tagFreq,
    capturedList: captured
    .filter((c) => !isNoiseCapture(c.title, c.summary, c.content, c.tags))
      .map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        content: c.content,
        tags: c.tags,
        createdAt: c.created_at,
        created_at: c.created_at,
      })),
    nodeList: nodes
      .filter((n) => !isTrivialNodeName(n.name))
      .map((n) => ({
        name: n.name,
        kind: n.kind,
        createdAt: n.created_at,
        sourceCount: Array.isArray(n.source_captured_ids) ? n.source_captured_ids.length : 0,
      })),
    linkList: scopeLinks
      .filter((l) => {
        const fromName = l.source_node?.name || '';
        const toName = l.target_node?.name || '';
        // 任一端是噪声节点即丢弃（如 "加班→1.5小时"、"第4章→注意力残余"）
        if (isTrivialNodeName(fromName) || isTrivialNodeName(toName)) return false;
        return true;
      })
      .map((l) => ({
        from: l.source_node?.name || '未知',
        to: l.target_node?.name || '未知',
        type: l.relation_type,
        evidenceCount: Array.isArray(l.evidence_captured_ids) ? l.evidence_captured_ids.length : 0,
      })),
    centralNodes,
    excerpts,
    graphNodes: nodes.filter((n) => !isTrivialNodeName(n.name)),
    graphLinks: scopeLinks.filter((l) => {
      const fromName = l.source_node?.name || '';
      const toName = l.target_node?.name || '';
      return !isTrivialNodeName(fromName) && !isTrivialNodeName(toName);
    }),
  };
}

// ---------------------------------------------------------------------------
// 趋势检测
// ---------------------------------------------------------------------------

interface TrendItem {
  label: string;
  direction: 'up' | 'down' | 'new' | 'stable';
  detail: string;
}

/**
 * 主题方向（等长窗口才可比）：
 *  - 7d: 本期 7 天 vs 上期 7 天（直接比次数）
 *  - 30d: 近 7 天 vs 更早 23 天（按出现率归一化）
 */
function computeThemeDirectionsFor(
  agg: AggregatedData,
  prevAgg: AggregatedData,
  period: string,
): Map<string, ThemeTrend> {
  let recentFreq: Map<string, number>;
  let olderFreq: Map<string, number>;
  let recentCount: number;
  let olderCount: number;
  let labelRecent: string;
  let labelOlder: string;

  if (period === '7d') {
    recentFreq = agg.tagFreq;
    olderFreq = prevAgg.tagFreq;
    recentCount = agg.capturedCount;
    olderCount = prevAgg.capturedCount;
    labelRecent = '本期';
    labelOlder = '上期';
  } else {
    const { recent, older } = splitByWindow(agg.capturedList, 7);
    recentFreq = tagFrequency(recent);
    olderFreq = tagFrequency(older);
    recentCount = recent.length;
    olderCount = older.length;
    labelRecent = '近7天';
    labelOlder = '更早';
  }

  const trends = computeThemeDirections(recentFreq, olderFreq, recentCount, olderCount, {
    minTotal: period === '7d' ? 2 : 3,
  });
  return new Map(
    trends
      .filter((t) => !isTrivialNodeName(t.name))
      .map((t) => [t.name, { ...t, detail: themeTrendDetailText(t, labelRecent, labelOlder) }]),
  );
}

function themeTrendDetailText(t: ThemeTrend, labelRecent: string, labelOlder: string): string {
  if (t.direction === 'new') return `${labelRecent}首次出现 ${t.recent} 次，是新的关注点`;
  if (t.direction === 'up') return `${labelRecent} ${t.recent} 次 vs ${labelOlder} ${t.older} 次，正在升温`;
  if (t.direction === 'down') return `${labelRecent} ${t.recent} 次 vs ${labelOlder} ${t.older} 次，热度在下降`;
  return `${labelRecent} ${t.recent} 次 vs ${labelOlder} ${t.older} 次，保持平稳`;
}

function detectTrends(current: AggregatedData, previous: AggregatedData, period: string): TrendItem[] {
  const trends: TrendItem[] = [];

  // 捕获量变化
  const captureDelta = current.capturedCount - previous.capturedCount;
  if (previous.capturedCount > 0) {
    const pct = Math.round((captureDelta / previous.capturedCount) * 100);
    if (pct >= 30) {
      trends.push({ label: '捕获活跃度', direction: 'up', detail: `记录数量增长 ${pct}%（${previous.capturedCount}→${current.capturedCount} 条）` });
    } else if (pct <= -30) {
      trends.push({ label: '捕获活跃度', direction: 'down', detail: `记录数量下降 ${Math.abs(pct)}%（${previous.capturedCount}→${current.capturedCount} 条）` });
    } else {
      trends.push({ label: '捕获活跃度', direction: 'stable', detail: `记录数量稳定（${current.capturedCount} 条）` });
    }
  } else if (current.capturedCount > 0) {
    trends.push({ label: '开始记录', direction: 'new', detail: `这是你开始系统记录的第一期（${current.capturedCount} 条）` });
  }

  // 新节点量变化
  const nodeDelta = current.newNodeCount - previous.newNodeCount;
  if (previous.newNodeCount > 0) {
    const pct = Math.round((nodeDelta / previous.newNodeCount) * 100);
    if (pct >= 30) trends.push({ label: '知识增长', direction: 'up', detail: `新知识节点增长 ${pct}%` });
    else if (pct <= -30) trends.push({ label: '知识增长', direction: 'down', detail: `新知识节点减少` });
  }

  // 新关系量
  const linkDelta = current.newLinkCount - previous.newLinkCount;
  if (previous.newLinkCount > 0 && linkDelta > 0) {
    const pct = Math.round((linkDelta / previous.newLinkCount) * 100);
    if (pct >= 30) trends.push({ label: '知识连接', direction: 'up', detail: `知识节点间的连接增长 ${pct}%` });
  }
  // 主题方向（等长窗口对比：7d=本期vs上期, 30d=近7天vs更早）
  const themeTrends = [...computeThemeDirectionsFor(current, previous, period).values()];
  const upThemes = themeTrends.filter((t) => t.direction === 'up').slice(0, 2);
  const newThemes = themeTrends.filter((t) => t.direction === 'new').slice(0, 2);
  const downThemes = themeTrends.filter((t) => t.direction === 'down').slice(0, 2);
  if (upThemes.length > 0) {
    trends.push({ label: '主题升温', direction: 'up', detail: `「${upThemes[0].name}」${upThemes[0].detail}${upThemes[1] ? `；「${upThemes[1].name}」也在上升` : ''}` });
  }
  if (newThemes.length > 0) {
    trends.push({ label: '新主题', direction: 'new', detail: `新出现「${newThemes[0].name}」（${newThemes[0].recent} 次）${newThemes[1] ? `、「${newThemes[1].name}」` : ''}——你最近开始关注新的领域` });
  }
  if (downThemes.length > 0) {
    trends.push({ label: '主题降温', direction: 'down', detail: `「${downThemes[0].name}」${downThemes[0].detail}` });
  }

  return trends.slice(0, 5);
}

async function fetchPreviousPeriod(
  scope: RequestScope,
  currentSince: string,
  supabaseKey: string,
): Promise<AggregatedData> {
  const days = 7; // 对比上一周
  const prevSince = new Date(new Date(currentSince).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const prevUntil = currentSince;

  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  const capturedFilter = scope.isDemo ? 'user_id=is.null' : `user_id=eq.${encodeURIComponent(scope.scopeId)}`;
  const capturedUrl = `${baseUrl}/rest/v1/captured_info?select=id,type,title,summary,content,tags,created_at&created_at=gte.${encodeURIComponent(prevSince)}&created_at=lt.${encodeURIComponent(prevUntil)}&${capturedFilter}&order=created_at.desc`;
  const captured: CapturedRow[] = (await fetchAllRows(capturedUrl, headers)) as CapturedRow[];

  const nodesUrl = `${baseUrl}/rest/v1/knowledge_nodes?select=id,name,kind,source_captured_ids,created_at&scope_id=eq.${encodeURIComponent(scope.scopeId)}&created_at=gte.${encodeURIComponent(prevSince)}&created_at=lt.${encodeURIComponent(prevUntil)}&order=created_at.desc`;
  const nodes: NodeRow[] = (await fetchAllRows(nodesUrl, headers)) as NodeRow[];

  const linksUrl = `${baseUrl}/rest/v1/knowledge_links?select=id,source,target,relation_type,evidence_captured_ids,created_at&scope_id=eq.${encodeURIComponent(scope.scopeId)}&created_at=gte.${encodeURIComponent(prevSince)}&created_at=lt.${encodeURIComponent(prevUntil)}&order=created_at.desc`;
  const rawLinks: LinkRow[] = (await fetchAllRows(linksUrl, headers)) as LinkRow[];

  const prevNodeIds = new Set(nodes.map((n) => n.id));
  const prevLinks = rawLinks.filter(
    (l) => prevNodeIds.has(l.source) || prevNodeIds.has(l.target),
  );

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
    capturedCapHit: captured.length >= 100,
    newNodeCount: nodes.length,
    newLinkCount: prevLinks.length,
    tagFreq,
    capturedList: [],
    nodeList: [],
    linkList: [],
    centralNodes: [],
    excerpts: [],
    graphNodes: [],
    graphLinks: [],
  };
}

// ---------------------------------------------------------------------------
// 确定性降级
// ---------------------------------------------------------------------------

/** 按方向配额选取主题动态：升温3 + 新生3 + 降温4，覆盖多主题库的次级信号 */
function pickThemeTrends(map: Map<string, ThemeTrend>): ThemeTrend[] {
  const all = [...map.values()];
  const by = (dir: ThemeTrend['direction'], n: number) => all.filter((t) => t.direction === dir).slice(0, n);
  return [...by('up', 3), ...by('new', 3), ...by('down', 4)];
}

/** 确定性叙事：LLM 不可用时也给出连贯、有洞察的叙述，而非数据罗列 */
function buildNarrative(
  agg: AggregatedData,
  period: string,
  themeDirections: Map<string, ThemeTrend>,
  communityBlocks: CommunityBlock[],
): string {
  const periodText = period === '7d' ? '这一周' : '这一个月';
  if (agg.capturedCount === 0) {
    return `${periodText}你还没有新的记录，图谱也没有新的变化。试着记录一件小事，系统才能帮你看见规律。`;
  }

  const parts: string[] = [];
  parts.push(`${periodText}你记录了 ${agg.capturedCount}${agg.capturedCapHit ? '+' : ''} 条内容，知识图谱随之新增了 ${agg.newNodeCount} 个节点和 ${agg.newLinkCount} 条关联。`);

  const sortedTags = [...agg.tagFreq.entries()].sort((a, b) => b[1] - a[1]);
  if (sortedTags.length > 0) {
    const top = sortedTags[0];
    const rising = [...themeDirections.values()]
      .filter((t) => (t.direction === 'up' || t.direction === 'new') && t.recent >= 2)
      .sort((a, b) => b.recent - a.recent)
      .slice(0, 1);
    const falling = [...themeDirections.values()]
      .filter((t) => t.direction === 'down')
      .sort((a, b) => b.older - a.older)
      .slice(0, 1);
    const themeBits: string[] = [`最集中的主题是「${top[0]}」（${top[1]} 次）`];
    if (rising.length > 0) {
      themeBits.push(`「${rising[0].name}」${rising[0].detail}`);
    }
    if (falling.length > 0) {
      themeBits.push(`而「${falling[0].name}」${falling[0].detail}`);
    }
    parts.push(themeBits.join('；') + '。');
  }

  if (agg.linkList.length > 0) {
    const topLinks = agg.linkList.slice(0, 2);
    const linkTexts = topLinks.map((l) => {
      const support = l.evidenceCount > 1
        ? `（${l.evidenceCount} 条记录共同支撑）`
        : '';
      return `「${l.from}」→「${l.to}」${support}`;
    });
    parts.push(`图谱里值得注意的新关联是 ${linkTexts.join('、')}${topLinks.length > 1 ? ' 等' : ''}——这些连接往往是跨领域规律的入口。`);
  }

  if (agg.centralNodes.length > 0) {
    parts.push(`当前知识网络的核心是「${agg.centralNodes[0].name}」，它串起了 ${agg.centralNodes[0].connectCount} 条记录。`);
  }
  // P2 社区演化：说出"出现了几个主题簇，哪个在扩张/收缩"
  if (communityBlocks.length > 0) {
    const growing = communityBlocks.filter((c) => c.evolution === 'growing');
    const shrinking = communityBlocks.filter((c) => c.evolution === 'shrinking');
    const evoBits: string[] = [];
    if (communityBlocks.length === 1) {
      const c = communityBlocks[0];
      evoBits.push(`知识图谱呈现出 ${c.nodeCount} 个节点构成的主题簇「${c.name}」${c.evolution === 'growing' ? `，正在扩张（近窗新增 ${c.recentNodes} 个节点、${c.recentCaptures} 条记录关联）` : c.evolution === 'shrinking' ? '，正在收缩' : ''}`);
    } else {
      evoBits.push(`知识图谱呈现出 ${communityBlocks.length} 个主题簇：${communityBlocks.map((c) => `「${c.name}」`).join('、')}`);
      if (growing.length > 0) {
        const g = growing[0];
        evoBits.push(`其中「${g.name}」在扩张（近窗新增 ${g.recentNodes} 个节点、${g.recentCaptures} 条记录关联）`);
      }
      if (shrinking.length > 0) {
        evoBits.push(`而「${shrinking[0].name}」在收缩（近窗没有新增节点）`);
      }
    }
    parts.push(evoBits.join('；') + '。');
  }

  // 综合：生活/工作模式洞察（数据模式 → 供 LLM 润色成"对人的洞察"，而非统计罗列）
  const lifeInsights: string[] = [];
  // 投入最集中（结合 tagFreq 最高 + 节点来源多）
  if (agg.capturedCount > 0 && agg.tagFreq.size > 0) {
    const topC = [...agg.tagFreq.entries()].sort((a, b) => b[1] - a[1])[0];
    lifeInsights.push(`你最近的精力主要在「${topC[0]}」（${topC[1]} 条记录），这很可能当前你最上心的一件事`);
  }
  // 明显趋势：什么在明显上升/下降——解读为生活重心的迁移
  const dirs = [...themeDirections.values()].filter((t) => t.recent >= 2);
  if (dirs.length > 0) {
    const rising = dirs.filter((t) => t.direction === 'up' || t.direction === 'new').sort((a, b) => b.recent - a.recent)[0];
    const falling = dirs.filter((t) => t.direction === 'down').sort((a, b) => b.older - a.older)[0];
    if (rising) lifeInsights.push(`「${rising.name}」在最近明显升温（近窗 ${rising.recent} 次）——可能是你正在投入的新方向，或生活阶段的转变`);
    if (falling) lifeInsights.push(`而「${falling.name}」热度在下降，可能是你渐渐放下、或告一段落的事`);
  }
  // 主题簇交织：不止一个块 → 生活同时铺开几条线
  if (communityBlocks.length >= 2) {
    lifeInsights.push(`你的内容同时铺在 ${communityBlocks.length} 条线上（${communityBlocks.slice(0, 3).map((c) => `「${c.name}」`).join('、')}）——可能你在几个领域并行推进`);
  }
  // 核心节点：反复出现、深挖的概念
  if (agg.centralNodes.length > 0) {
    lifeInsights.push(`「${agg.centralNodes[0].name}」是你目前最深入的一个想法（关联 ${agg.centralNodes[0].connectCount} 条内容）`);
  }
  // 投入深度预测（公共模块）：记录数 vs 关联度 → 哪些"只记没思考"（浅），哪些"真在深入"（深）
  const depth = computeDepthProfile(
    agg.nodeList.map((n) => ({ name: n.name, sourceCount: n.sourceCount })),
    agg.linkList.map((l) => ({ source: l.from, target: l.to })),
  );
  if (depth.shallow[0]) lifeInsights.push(`「${depth.shallow[0].name}」你记了 ${depth.shallow[0].sourceCount} 次，但图里还没和任何东西连起来——可能只是记录、还没真正想明白，建议给它找一个连接点或补一段自己的思考`);
  if (depth.deep[0]) lifeInsights.push(`「${depth.deep[0].name}」是枢纽（连着 ${depth.deep[0].degree} 个概念），你已经把它和很多想法串起来了——这是你思考最深的领域，适合往"产出或整合"推进`);
  // 隐含关联预测（公共模块）：公共邻居重叠 → 你还没意识到的深度关联
  const implicit = findImplicitPairs(
    agg.nodeList.map((n) => n.name),
    agg.linkList.map((l) => ({ source: l.from, target: l.to })),
    { maxPairs: 1 },
  );
  if (implicit[0]) lifeInsights.push(`「${implicit[0].a}」和「${implicit[0].b}」连着一群相同的概念，但你没有把它们直接关联——它们很可能在你心里同属一件事，值得主动连起来想想`);
  if (lifeInsights.length > 0) {
    parts.push(`综合看：${lifeInsights.join('；')}。`);
  }

  return parts.join(' ');
}

function buildDeterministicResponse(
  agg: AggregatedData,
  period: string,
  trends: TrendItem[],
  themeDirections: Map<string, ThemeTrend>,
  communityBlocks: CommunityBlock[],
) {
  const sortedTags = [...agg.tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const themes = sortedTags.map(([name, count]) => {
    const dir = themeDirections.get(name);
    return {
      name,
      count,
      direction: dir?.direction || 'stable',
      detail: dir?.detail || '',
    };
  });
  const importantNodes = agg.centralNodes.map((n) => ({
    name: n.name,
    kind: n.kind,
    reason: `关联 ${n.connectCount} 条捕获，是当前知识网络的核心节点`,
  }));

  const newConnections = agg.linkList.slice(0, 5).map((l) => ({
    from: l.from,
    to: l.to,
    relationType: l.type,
    significance: l.evidenceCount > 1
      ? `由 ${l.evidenceCount} 条记录共同支撑，不是偶然出现的关联`
      : l.evidenceCount === 1
        ? '目前只由 1 条记录支撑，值得继续观察'
        : '',
  }));

  const nextActions: string[] = [];

  // 1. 捕获量评估
  if (agg.capturedCount === 0) {
    nextActions.push('当前没有新捕获的内容，去记录一些想法吧');
  } else if (agg.capturedCount <= 3) {
    nextActions.push(`近${period}只记录了 ${agg.capturedCount} 条，试着每天记一条，积累越多越容易发现规律`);
  }

  // 2. 未生成知识节点——引导关联
  if (agg.newNodeCount === 0 && agg.capturedCount > 0) {
    nextActions.push(`${agg.capturedCount} 条新捕获都没有生成知识节点，检查图谱抽取是否正常，或手动为重要内容创建节点`);
  }

  // 3. 升温/新生主题——当前生活的重心，给出具体动作
  const risingThemes = [...themeDirections.values()]
    .filter((t) => (t.direction === 'up' || t.direction === 'new') && t.recent >= 2)
    .sort((a, b) => b.recent - a.recent)
    .slice(0, 2);
  for (const t of risingThemes) {
    nextActions.push(
      t.direction === 'new'
        ? `「${t.name}」是最近新出现的关注点（${t.recent} 次）——它可能是你生活里新冒出的东西，值得想想你想不想深入，还是只是随手记下`
        : `「${t.name}」最近明显升温（本期 ${t.recent} 次 vs 上期 ${t.older} 次），很可能是你当前的精力所在——试着把它讲成一条线，看看自己为什么花时间在这`,
    );
  }

  // 4. 降温主题——可能是想放弃或已告一段落的事
  const fallingTheme = [...themeDirections.values()]
    .filter((t) => t.direction === 'down')
    .sort((a, b) => b.older - a.older)[0];
  if (fallingTheme) {
    nextActions.push(`「${fallingTheme.name}」的热度在下降（本期 ${fallingTheme.recent} 次 vs 上期 ${fallingTheme.older} 次）——如果是你想坚持的事，记一条"为什么中断"，往往比强迫自己继续更有效`);
  }

  // 5. 核心节点——给出具体探索方向
  if (agg.centralNodes.length > 0) {
    const top = agg.centralNodes[0];
    const topTags = [...agg.tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topTags.length > 0) {
      nextActions.push(`「${top.name}」是你目前想得最多的概念（关联 ${top.connectCount} 条）——回看这些内容，你很可能在「${topTags.map(([n]) => `「${n}」`).join('、')}」上有自己未成型的看法，值得整理出来`);
    } else {
      nextActions.push(`「${top.name}」是你目前想得最多的概念——回看这些记录，看看你在这个想法上已经积累了哪些东西`);
    }
  }

  // 6. 捕获量趋势驱动的行动
  const growthTrend = trends.find((t) => t.direction === 'up' && t.detail.includes('增长'));
  if (growthTrend) {
    nextActions.push(`记录量在上升，趁热打铁：本周每天固定时段捕获，养成习惯后你会看到更清晰的趋势`);
  }

  return {
    ok: true,
    period,
    narrative: buildNarrative(agg, period, themeDirections, communityBlocks),
    themes,
    importantNodes,
    newConnections,
    nextActions,
    trends,
    themeTrends: pickThemeTrends(themeDirections),
    communities: communityBlocks.map((c) => ({
      name: c.name,
      nodeCount: c.nodeCount,
      capturedCount: c.capturedCount,
      evolution: c.evolution,
      summary: c.summary,
    })),
    highlights: agg.excerpts,
    weeklyTimeline: buildWeeklyTimeline(agg, period),
    stats: {
      capturedCount: agg.capturedCount,
      newNodeCount: agg.newNodeCount,
      newLinkCount: agg.newLinkCount,
    },
  };
}

/**
 * P3 时序分段：30d 按周切 4 段（第1周=最近7天 … 第4周=22-28天前），
 * 每段输出确定性骨架（高频标签+次数），供 LLM 综合成"第1周→第4周变化弧线"。
 * 7d 返回 null（窗口太短不值得分段）。
 */
function buildWeeklyTimeline(agg: AggregatedData, period: string): string | null {
  if (period !== '30d') return null;
  const now = Date.now();
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const rows: string[] = [];

  for (let w = 0; w < 4; w += 1) {
    const end = now - w * WEEK_MS;
    const start = end - WEEK_MS;
    const weekCaptured = agg.capturedList.filter((c) => {
      const t = new Date(c.created_at).getTime();
      return Number.isFinite(t) && t >= start && t < end;
    });
    const freq = tagFrequency(
      weekCaptured.map((c) => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] })),
    );
    const top = [...freq.entries()]
      .filter(([tag]) => !isTrivialNodeName(tag))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const label = w === 0 ? '最近一周' : `往前第${w + 1}周`;
    rows.push(`- ${label}（${weekCaptured.length} 条记录）：${top.length ? top.map(([t, c]) => `${t}(${c}次)`).join('、') : '无明确主题'}`);
  }

  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

function formatContextForLLM(
  agg: AggregatedData,
  trends: TrendItem[],
  themeDirections: Map<string, ThemeTrend>,
  period: string,
  communityBlocks: CommunityBlock[],
): string {
  const parts: string[] = [];

  // 确定性骨架先行：LLM 只做"骨架的连贯化与证据填充"，禁止引入骨架之外的新事实
  parts.push(`你是一位知识管理教练。下面是系统从用户数据中计算出的【确定性骨架】。你的工作：把骨架润色成生动、连贯、有洞察的叙事式总结——只允许优化措辞、补充过渡语，禁止新增骨架中不存在的事实、数字、因果、主题或关联。`);
  parts.push(`\n## 确定性骨架（唯一事实来源，禁止改写其数字与断言）`);
  parts.push(buildNarrative(agg, period, themeDirections, communityBlocks));

  // 主题方向明细（骨架的组成部分：升温3 + 新生3 + 降温4，数字不可改写）
  const dirThemes = pickThemeTrends(themeDirections);
  if (dirThemes.length > 0) {
    parts.push(`\n## 主题方向明细（骨架的一部分，数字不可改写）`);
    parts.push(dirThemes.map((t) => `- ${t.name}（${t.direction}）：${t.detail}`).join('\n'));
  }

  // P2 社区摘要：每个主题簇一句话，供 LLM 综合"社区演化"
  if (communityBlocks.length > 0) {
    parts.push(`\n## 主题簇（社区检测，骨架的一部分）`);
    parts.push(communityBlocks.map((c) => `- ${c.summary}`).join('\n'));
  }

  // P3 时序分段：30d 按周切 4 段，供 LLM 写出"第1周→第4周变化弧线"
  const weekly = buildWeeklyTimeline(agg, period);
  if (weekly) {
    parts.push(`\n## 每周变化（骨架的一部分，数字不可改写）`);
    parts.push(weekly);
  }

  // 统计数据
  parts.push(`\n## 统计数据`);
  parts.push(`- 新捕获：${agg.capturedCount} 条`);
  parts.push(`- 新知识节点：${agg.newNodeCount} 个`);
  parts.push(`- 新知识关系：${agg.newLinkCount} 条`);

  const sortedTags = [...agg.tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (sortedTags.length > 0) {
    parts.push(`- 高频标签：${sortedTags.map(([t, c]) => `${t}(${c}次)`).join('、')}`);
  }

  // 核心节点
  if (agg.centralNodes.length > 0) {
    parts.push(`\n## 核心知识节点`);
    parts.push(agg.centralNodes.map((n) => `- ${n.name} [${n.kind}]：关联 ${n.connectCount} 条内容`).join('\n'));
  }

  // 新关系
  if (agg.linkList.length > 0) {
    parts.push(`\n## 新增关系（最多 8 条）`);
    parts.push(agg.linkList.slice(0, 8).map((l) => `- ${l.from} → ${l.to}（${l.type}）`).join('\n'));
  }

  // 趋势
  if (trends.length > 0) {
    parts.push(`\n## 变化趋势`);
    parts.push(trends.map((t) => `- ${t.label}：${t.detail}`).join('\n'));
  }

  // 原文摘录
  if (agg.excerpts.length > 0) {
    parts.push(`\n## 代表性记录摘录`);
    parts.push(agg.excerpts.map((e) => `- ${e}`).join('\n'));
  }

  // 捕获列表（摘要）
  if (agg.capturedList.length > 0) {
    parts.push(`\n## 近期所有记录（最多 15 条）`);
    parts.push(agg.capturedList.slice(0, 15).map((c) => {
      const tagStr = c.tags?.length ? `[${c.tags.join(', ')}]` : '';
      const excerpt = (c.summary || c.content || '').slice(0, 80);
      return `- ${c.title}${tagStr ? ' ' + tagStr : ''}${excerpt ? '：' + excerpt : ''}`;
    }).join('\n'));
  }

  return parts.join('\n').slice(0, MAX_INPUT_CHARS);
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
          content: `你是知识管理教练。根据用户近期数据，生成深度结构化总结。只返回 JSON，不要 Markdown。
【最高优先级·严禁编造数据】上下文顶部给出了【确定性骨架】——这是系统从用户数据中计算出的唯一事实来源。你只能原样引用骨架中明确出现的数字短语（如"记录数量增长 900%"）与断言，禁止创造、改写或换算任何数字、百分比、倍数与时间跨度（如"连续三个月""下降32%""飙升5倍"）；禁止引入骨架之外的新事实、新主题、新因果。需要表达量级时用定性词（"明显上升""大幅减少"）。所有因果断言必须能被骨架或捕获记录直接支撑。这是硬性要求，违反即视为失败。

JSON 格式（每字段最多 5 项）：
{
  "narrative": "一段连贯的叙事式总结（100-200字），把确定性骨架润色成有温度、有洞察的叙述。分析用户这段时间在关注什么、什么在变化、有什么值得注意的模式。不要罗列数据，要讲故事、找关联、给出洞察。用第二人称"你"。",
  "themes": [{"name": "主题名", "count": 数字, "insight": "关于这个主题的一两句深度分析"}],
  "importantNodes": [{"name": "节点名", "kind": "类型", "reason": "为什么重要（结合用户行为和趋势）"}],
  "newConnections": [{"from": "A", "to": "B", "relationType": "关系类型", "significance": "这个关联对用户的意义"}],
  "nextActions": ["具体可执行的下一步行动建议（要有依据，来自数据中发现的模式、缺口或趋势）"]
}

要求：
- narrative 要生动、有温度、有洞察，像一位了解你的教练在跟你对话；但必须忠实于确定性骨架，骨架没有说到的数据点一律不要出现
- 【时间推进】如果上下文包含【每周变化】章节，narrative 必须体现时间推进弧线（如"第1周…到第4周…"），明确各周关注点如何迁移，但只使用骨架中的周数据
- themes 的 insight 不要只说"这是高频主题"，要分析该主题的出现模式、与其它主题的关联
- nextActions 要具体可执行（如"本周尝试记录每次加班后的睡眠时长，检验你怀疑的因果关系"），不要空话（如"继续努力"）
- 【重要】忽略以下无意义内容：日常琐碎（吃饭、睡觉、通勤）、具体时刻（22点、00:40）、泛化概念（计划、工作、学习、生活）、泛称地点（家、公司、食堂）。这些不会产生有价值的洞察
- importantNodes 只选对用户有实质意义的节点（如具体项目名、方法论、工具、人名、关键结论），不要选日常生活类节点
- 如果数据中只有琐碎节点，importantNodes 可以少于 5 个，宁缺毋滥`,
        },
        { role: 'user', content },
      ],
    }),
  });

  const text = await resp.text();
  const json = safeJsonParse(text);
  return { ok: resp.ok, status: resp.status, text, json };
}

/**
 * P2：为一个主题簇生成一句话摘要（LLM 小调用，失败返回 null 由调用方降级）。
 * 输入=簇内节点名 + 关联捕获标题；输出≤60字的一句话。
 */
async function summarizeCommunity(
  c: Community,
  agg: AggregatedData,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string | null> {
  const nodeNameById = new Map(agg.graphNodes.map((n) => [n.id, n.name]));
  const nodeNames = c.nodeIds
    .map((id) => nodeNameById.get(id))
    .filter((x): x is string => Boolean(x))
    .slice(0, 12);
  const captureTitleById = new Map(agg.capturedList.map((x) => [x.id, x.title]));
  const captureTitles = [...c.capturedIds]
    .map((id) => captureTitleById.get(id))
    .filter((x): x is string => Boolean(x))
    .slice(0, 6);

  const prompt =
    `你是一位知识管理教练。用户的近期知识图谱里有一个主题簇（一组紧密关联的知识节点）。` +
    `请用不超过 60 字的一句话概括这个主题簇在说什么、对用户意味着什么，不要罗列节点名。只返回 JSON：{"summary":"..."}\n\n` +
    `知识节点：${nodeNames.join('、')}\n` +
    `相关记录：${captureTitles.join('、') || '(无)'}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          { role: 'system', content: '你是一位知识管理教练。只返回严格 JSON，不要 Markdown。' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const body = safeJsonParse(await resp.text());
    const choices = body && typeof body === 'object' && 'choices' in body ? (body as Record<string, unknown>).choices : null;
    const msg = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined)?.message : null;
    const text = msg && typeof msg === 'object' && 'content' in msg ? (msg as Record<string, unknown>).content : null;
    if (typeof text !== 'string') return null;
    const parsed = normalizeContentToJson(text);
    const summary = parsed && typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    return summary.length > 0 ? summary : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    const agg = await aggregateData(requestScope, since, queryToken);

    // 趋势检测：查询上一周期做对比
    const prevAgg = await fetchPreviousPeriod(requestScope, since, queryToken);
    const trends = detectTrends(agg, prevAgg, period);
    // 主题方向：等长窗口对比（7d=本期vs上期, 30d=近7天vs更早）
    const themeDirections = computeThemeDirectionsFor(agg, prevAgg, period);

    // 无数据
    if (agg.capturedCount === 0 && agg.newNodeCount === 0) {
      const empty = buildDeterministicResponse(agg, period, trends, themeDirections, []);
      res.status(200).json(empty);
      return;
    }

    // 尝试 LLM
    const apiKey = resolveApiKey(req);
    const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
    const preferredModel = process.env.MINIMAX_MODEL || 'abab6.5s-chat';

    // P2 社区检测：把周期内图谱切成主题簇，供社区摘要与叙事使用
    const communities = detectCommunities(agg.graphNodes, agg.graphLinks, {
      recentBoundaryDays: Math.ceil(days / 2),
    });
    // 社区摘要：LLM 小调用（并行，失败降级确定性描述）
    const communityBlocks: CommunityBlock[] = await Promise.all(
      communities.slice(0, 4).map(async (c) => {
        const llm = apiKey
          ? await summarizeCommunity(c, agg, apiKey, baseUrl, preferredModel)
          : null;
        return {
          name: c.name,
          nodeCount: c.nodeCount,
          capturedCount: c.capturedIds.size,
          recentNodes: c.recentNodes,
          recentCaptures: c.recentCaptures,
          evolution: evolutionOf(c),
          summary: llm || describeCommunity(c),
        };
      }),
    );

    if (!apiKey) {
      const fallback = buildDeterministicResponse(agg, period, trends, themeDirections, communityBlocks);
      fallback.nextActions.push('LLM 不可用，当前为统计摘要');
      res.status(200).json(fallback);
      return;
    }

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

    const context = formatContextForLLM(agg, trends, themeDirections, period, communityBlocks);

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
        const narrative = typeof parsed.narrative === 'string' ? parsed.narrative : undefined;

        const themes = Array.isArray(parsed.themes)
          ? (parsed.themes as Record<string, unknown>[]).map((t) => {
              const name = typeof t.name === 'string' ? t.name : '';
              // 方向匹配：LLM 主题名可能包装了标签（"加班的系统性归因"→"加班"）；
              // 取主题名中最早出现的标签（"冥想与注意力训练"→"冥想"而非"注意力"），
              // 同位置时取更长的标签。
              let dir = themeDirections.get(name);
              if (!dir) {
                let bestPos = Number.POSITIVE_INFINITY;
                let bestLen = 0;
                for (const [tag, trend] of themeDirections) {
                  const pos = name.indexOf(tag);
                  if (pos >= 0 && (pos < bestPos || (pos === bestPos && tag.length > bestLen))) {
                    dir = trend;
                    bestPos = pos;
                    bestLen = tag.length;
                  }
                }
              }
              return {
                name,
                count: typeof t.count === 'number' ? t.count : 0,
                insight: typeof t.insight === 'string' ? t.insight : '',
                direction: dir?.direction || 'stable',
                detail: dir?.detail || '',
              };
            })
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
              significance: typeof c.significance === 'string' ? c.significance : '',
            }))
          : [];

        const nextActions = Array.isArray(parsed.nextActions)
          ? (parsed.nextActions as string[]).filter((a): a is string => typeof a === 'string')
          : [];

        res.status(200).json({
          ok: true,
          period,
          narrative: narrative || buildNarrative(agg, period, themeDirections, communityBlocks),
          themes: themes.slice(0, 5),
          importantNodes: importantNodes.slice(0, 5),
          newConnections: newConnections.slice(0, 5),
          themeTrends: pickThemeTrends(themeDirections),
          communities: communityBlocks.map((c) => ({
            name: c.name,
            nodeCount: c.nodeCount,
            capturedCount: c.capturedCount,
            evolution: c.evolution,
            summary: c.summary,
          })),
          nextActions: nextActions.slice(0, 5),
          trends,
          highlights: agg.excerpts,
          weeklyTimeline: buildWeeklyTimeline(agg, period),
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
    const fallback = buildDeterministicResponse(agg, period, trends, themeDirections, communityBlocks);
    res.status(200).json(fallback);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const status = message === 'Authentication required' || message === 'Invalid authentication token' ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Unauthorized' : 'Summarize failed', detail: message });
  }
}
