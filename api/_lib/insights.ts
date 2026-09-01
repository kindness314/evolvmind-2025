/**
 * api/_lib/insights.ts — 推荐与总结共用的深度洞察计算
 *
 * 职责：
 * 1. 共享行类型（CapturedRow / NodeRow / LinkRow）——消除 recommend/summarize 的重复定义
 * 2. 时间窗划分 + 主题趋势：同一主题在"近窗 vs 远窗"的频率变化（上升/下降/新生/平稳）
 * 3. 图谱索引：捕获↔节点邻接、节点邻接表，供二跳传导链分析复用
 * 4. 传导链文案：把二跳路径渲染成人话（「加班」→「睡眠不足」→「咖啡」）
 *
 * 设计原则：所有函数纯计算、无副作用、无 IO，便于单测。
 */

// ---------------------------------------------------------------------------
// 共享行类型
// ---------------------------------------------------------------------------

export interface CapturedRow {
  id: string;
  type?: string;
  title: string;
  summary?: string;
  content?: string;
  tags: string[];
  created_at: string;
}

export interface NodeRow {
  id: string;
  name: string;
  kind: string;
  source_captured_ids?: string[];
  created_at?: string;
}

export interface LinkRow {
  id?: string;
  source: string;
  target: string;
  relation_type?: string;
  evidence_captured_ids?: string[];
  created_at?: string;
  source_node?: { name: string } | null;
  target_node?: { name: string } | null;
}

// ---------------------------------------------------------------------------
// 时间窗与主题趋势
// ---------------------------------------------------------------------------

export interface ThemeTrend {
  name: string;
  /** 近窗（如最近 7 天）出现次数 */
  recent: number;
  /** 远窗（窗口其余时间）出现次数 */
  older: number;
  total: number;
  direction: 'up' | 'down' | 'new' | 'stable';
  /** 人话描述，如 "近7天 4 次，前23天 2 次，正在上升" */
  detail: string;
}

/** 按天数把捕获分成近窗/远窗 */
export function splitByWindow(
  captured: CapturedRow[],
  boundaryDays: number,
): { recent: CapturedRow[]; older: CapturedRow[] } {
  const boundary = Date.now() - boundaryDays * 24 * 3600 * 1000;
  const recent: CapturedRow[] = [];
  const older: CapturedRow[] = [];
  for (const c of captured) {
    const t = new Date(c.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (t >= boundary) recent.push(c);
    else older.push(c);
  }
  return { recent, older };
}

/** 标签频率统计 */
export function tagFrequency(captured: CapturedRow[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const c of captured) {
    if (!Array.isArray(c.tags)) continue;
    for (const tag of c.tags) {
      if (typeof tag !== 'string' || !tag.trim()) continue;
      freq.set(tag, (freq.get(tag) || 0) + 1);
    }
  }
  return freq;
}

/**
 * 主题趋势：同一标签在近窗 vs 远窗的频率对比。
 * - new: 远窗 0 次、近窗 >0 → 新关注点
 * - up:  近窗 ≥ 远窗×1.5 且近窗比远窗至少多 1 次 → 正在升温
 * - down: 对称 → 正在降温
 * - stable: 其余
 */
export function computeThemeTrends(
  captured: CapturedRow[],
  boundaryDays: number,
  minTotal = 2,
): ThemeTrend[] {
  const { recent, older } = splitByWindow(captured, boundaryDays);
  return computeThemeDirections(
    tagFrequency(recent),
    tagFrequency(older),
    recent.length,
    older.length,
    { minTotal },
  );
}

/**
 * 由两个频率表直接计算主题方向。
 * 采用"次数 + 相对占比"双条件（近窗 ≥ 远窗×1.5 且至少多 1 次），
 * 与用户直觉一致（"本期 3 次 vs 上期 1 次 → 升温"）；
 * 窗口大小不同时按出现率归一化只在方向判断的边缘处起作用，主判据仍是次数。
 * 供 summarize 的 7d(本期 vs 上期) 与 30d(近7天 vs 更早) 两种窗口复用。
 */
export function computeThemeDirections(
  recentFreq: Map<string, number>,
  olderFreq: Map<string, number>,
  recentCount: number,
  olderCount: number,
  opts: { minTotal?: number; minRecent?: number } = {},
): ThemeTrend[] {
  const { minTotal = 2, minRecent = 0 } = opts;
  const names = new Set([...recentFreq.keys(), ...olderFreq.keys()]);
  const out: ThemeTrend[] = [];

  for (const name of names) {
    const r = recentFreq.get(name) || 0;
    const o = olderFreq.get(name) || 0;
    if (r + o < minTotal) continue;

    let direction: ThemeTrend['direction'] = 'stable';
    if (o === 0 && r > 0) direction = 'new';
    else if (r === 0 && o > 0) direction = 'down';
    else if (r >= minRecent && r >= o + 1 && r / o >= 1.5) direction = 'up';
    else if (o >= r + 1 && o / r >= 1.5) direction = 'down';

    out.push({
      name,
      recent: r,
      older: o,
      total: r + o,
      direction,
      detail: buildThemeTrendDetail(name, r, o, direction),
    });
  }

  const rank = { up: 0, new: 1, down: 2, stable: 3 } as const;
  out.sort((a, b) => rank[a.direction] - rank[b.direction] || b.total - a.total);
  return out;
}

function buildThemeTrendDetail(
  name: string,
  recent: number,
  older: number,
  direction: ThemeTrend['direction'],
): string {
  if (direction === 'new') return `近窗首次出现 ${recent} 次，是新的关注点`;
  if (direction === 'up') return `近窗 ${recent} 次 vs 远窗 ${older} 次，正在升温`;
  if (direction === 'down') return `近窗 ${recent} 次 vs 远窗 ${older} 次，热度在下降`;
  return `近窗 ${recent} 次 vs 远窗 ${older} 次，保持平稳`;
}

// ---------------------------------------------------------------------------
// 图谱索引与传导链
// ---------------------------------------------------------------------------

export interface GraphIndex {
  /** 节点 ID → 关联的捕获 ID 集合 */
  nodeToCaptured: Map<string, Set<string>>;
  /** 捕获 ID → 关联的节点 ID 集合 */
  capturedToNodes: Map<string, Set<string>>;
  /** 无向邻接表：节点 ID → 相邻节点 ID 集合 */
  adj: Map<string, Set<string>>;
  /** 节点 ID → 节点行 */
  nodeById: Map<string, NodeRow>;
  /** 已关联到知识节点的捕获 ID 集合 */
  linkedCapturedIds: Set<string>;
}

export function buildGraphIndex(nodes: NodeRow[], links: LinkRow[]): GraphIndex {
  const nodeToCaptured = new Map<string, Set<string>>();
  const capturedToNodes = new Map<string, Set<string>>();
  const linkedCapturedIds = new Set<string>();
  const nodeById = new Map<string, NodeRow>();

  for (const node of nodes) {
    nodeById.set(node.id, node);
    const set = new Set<string>();
    if (Array.isArray(node.source_captured_ids)) {
      for (const cid of node.source_captured_ids) {
        if (typeof cid !== 'string') continue;
        set.add(cid);
        linkedCapturedIds.add(cid);
        if (!capturedToNodes.has(cid)) capturedToNodes.set(cid, new Set());
        capturedToNodes.get(cid)!.add(node.id);
      }
    }
    nodeToCaptured.set(node.id, set);
  }

  const adj = new Map<string, Set<string>>();
  for (const link of links) {
    if (!adj.has(link.source)) adj.set(link.source, new Set());
    if (!adj.has(link.target)) adj.set(link.target, new Set());
    adj.get(link.source)!.add(link.target);
    adj.get(link.target)!.add(link.source);
  }

  return { nodeToCaptured, capturedToNodes, adj, nodeById, linkedCapturedIds };
}

/** 图谱二跳桥路径：captureA 的节点 → 中间节点 M → captureB 的节点 */
export interface BridgePath {
  captureA: CapturedRow;
  captureB: CapturedRow;
  nodeA: NodeRow;
  nodeB: NodeRow;
  midNode: NodeRow | null;
}

/**
 * 查找两个捕获之间的二跳图桥路径。
 * 约束：A/B 不共享标签（避免与 related 规则重复）；中间节点不直接关联 A 或 B（保证是真正的"桥"）。
 */
export function findGraphBridgePaths(
  captured: CapturedRow[],
  index: GraphIndex,
  maxResults = 10,
): BridgePath[] {
  const results: BridgePath[] = [];
  const { capturedToNodes, adj, nodeById } = index;

  for (let i = 0; i < captured.length && results.length < maxResults; i++) {
    for (let j = i + 1; j < captured.length && results.length < maxResults; j++) {
      const capA = captured[i];
      const capB = captured[j];

      const aTags = new Set((capA.tags || []).map((t) => t.toLowerCase()));
      const bTags = (capB.tags || []).map((t) => t.toLowerCase());
      if (bTags.some((t) => aTags.has(t))) continue;

      const nodesA = capturedToNodes.get(capA.id);
      const nodesB = capturedToNodes.get(capB.id);
      if (!nodesA || !nodesB || nodesA.size === 0 || nodesB.size === 0) continue;

      let found = false;
      for (const na of nodesA) {
        if (found) break;
        const neighbors = adj.get(na);
        if (!neighbors) continue;
        for (const mid of neighbors) {
          if (found) break;
          const midSet = index.nodeToCaptured.get(mid);
          if (midSet?.has(capA.id) || midSet?.has(capB.id)) continue;
          for (const nb of nodesB) {
            if (adj.get(mid)?.has(nb)) {
              const nodeA = nodeById.get(na);
              const nodeB = nodeById.get(nb);
              if (nodeA && nodeB && nodeA.id !== nodeB.id) {
                results.push({
                  captureA: capA,
                  captureB: capB,
                  nodeA,
                  nodeB,
                  midNode: nodeById.get(mid) || null,
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

/** 传导链文案：「加班」→「睡眠不足」→「咖啡」 */
export function chainText(nodeA: string, mid: string | null, nodeB: string): string {
  if (!mid) return `「${nodeA}」⇄「${nodeB}」`;
  return `「${nodeA}」→「${mid}」→「${nodeB}」`;
}

// ---------------------------------------------------------------------------
// Personalized PageRank（P7 图桥升级，HippoRAG 思路）
// ---------------------------------------------------------------------------

/**
 * Personalized PageRank：以 seedNodeIds 为种子（teleport 分布），
 * 沿图邻接迭代传播概率，返回每个节点的 PPR 分数。
 * 分数高的节点 = 从种子出发最容易被"传导"到达的节点。
 */
export function personalizedPageRank(
  index: GraphIndex,
  seedNodeIds: string[],
  opts: { alpha?: number; iterations?: number } = {},
): Map<string, number> {
  const { alpha = 0.85, iterations = 20 } = opts;
  const nodeIds = [...index.nodeById.keys()];
  if (nodeIds.length === 0) return new Map();

  // 初始分布：种子均分，其余为 0
  const rank = new Map<string, number>();
  for (const id of nodeIds) rank.set(id, 0);
  const teleport = new Map<string, number>();
  const seedSum = seedNodeIds.length || 1;
  for (const id of seedNodeIds) {
    if (index.nodeById.has(id)) {
      rank.set(id, 1 / seedSum);
      teleport.set(id, 1 / seedSum);
    }
  }

  const outDeg = new Map<string, number>();
  for (const [id, neighbors] of index.adj) {
    outDeg.set(id, neighbors.size);
  }

  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Map<string, number>();
    for (const id of nodeIds) next.set(id, (1 - alpha) * (teleport.get(id) || 0));

    for (const [from, neighbors] of index.adj) {
      const deg = outDeg.get(from) || 1;
      const share = (alpha * (rank.get(from) || 0)) / deg;
      for (const to of neighbors) {
        next.set(to, (next.get(to) || 0) + share);
      }
    }

    // 归一化（防浮点漂移）
    let sum = 0;
    for (const v of next.values()) sum += v;
    if (sum > 0) {
      for (const id of nodeIds) next.set(id, (next.get(id) || 0) / sum);
    }
    for (const id of nodeIds) rank.set(id, next.get(id) || 0);
  }

  return rank;
}

/**
 * PPR 图桥：以捕获 A 的节点为种子跑 PPR，用 PPR 分数给二跳桥路径排序。
 * 返回分数从高到低的路径——传导链命中真实因果链的比例应高于朴素二跳遍历。
 */
export function findPprBridgePaths(
  captured: CapturedRow[],
  index: GraphIndex,
  maxResults = 10,
): Array<BridgePath & { pprScore: number }> {
  // 先找候选二跳桥（复用朴素遍历找路径结构）
  const base = findGraphBridgePaths(captured, index, maxResults * 3);
  if (base.length === 0) return [];

  // 每个捕获 A 的 PPR 结果缓存（同一 A 多条路径只算一次）
  const pprCache = new Map<string, Map<string, number>>();
  const pprFor = (seedIds: string[]): Map<string, number> => {
    const key = [...seedIds].sort().join('\u0000');
    const cached = pprCache.get(key);
    if (cached) return cached;
    const result = personalizedPageRank(index, seedIds, { alpha: 0.85, iterations: 15 });
    pprCache.set(key, result);
    return result;
  };

  const scored = base.map((bp) => {
    const seeds = index.capturedToNodes.get(bp.captureA.id);
    const ppr = seeds && seeds.size > 0 ? pprFor([...seeds]) : new Map<string, number>();
    // 传导强度 = 中间节点（或 B 端节点）在 A 种子 PPR 下的分数
    const targetId = bp.midNode ? bp.midNode.id : bp.nodeB.id;
    return { ...bp, pprScore: ppr.get(targetId) || 0 };
  });

  return scored.sort((a, b) => b.pprScore - a.pprScore).slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// 图谱驱动预测（2026-09）：投入深度 + 隐含关联 —— 纯函数可单测
// ---------------------------------------------------------------------------

export interface DepthNode {
  name: string;
  sourceCount: number;
}

export interface DepthProfile {
  /** 记录多但图里无关联 → "只记没思考"（浅） */
  shallow: Array<{ name: string; sourceCount: number }>;
  /** 图里高度关联（枢纽）→ "在深入"（深） */
  deep: Array<{ name: string; degree: number; sourceCount: number }>;
}

/** 投入深度预测：按"记录数（sourceCount）vs 关联度（degree）"判定每个概念是浅（只记没思考）还是深（在深入/枢纽）。 */
export function computeDepthProfile(
  nodes: DepthNode[],
  links: Array<{ source: string; target: string }>,
  opts: { shallowMinSource?: number; deepMinDegree?: number } = {},
): DepthProfile {
  const { shallowMinSource = 2, deepMinDegree = 3 } = opts;
  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }
  const shallow: DepthProfile['shallow'] = [];
  const deep: DepthProfile['deep'] = [];
  for (const n of nodes) {
    const d = degree.get(n.name) || 0;
    if (n.sourceCount >= shallowMinSource && d === 0) shallow.push({ name: n.name, sourceCount: n.sourceCount });
    if (d >= deepMinDegree) deep.push({ name: n.name, degree: d, sourceCount: n.sourceCount });
  }
  // 深：按 degree 降序
  deep.sort((a, b) => b.degree - a.degree);
  return { shallow, deep };
}

export interface ImplicitPair {
  a: string;
  b: string;
  /** 公共邻居数 */
  common: number;
}

/**
 * 隐含关联预测：结构上"接近"但没直接连的概念对（公共邻居 >= minCommon）。
 * 原理：A、B 连着多个相同的其它概念，很可能在用户心里同属一件事，只是没显式关联。
 */
export function findImplicitPairs(
  names: string[],
  links: Array<{ source: string; target: string }>,
  opts: { minCommon?: number; maxPairs?: number; avoid?: Set<string> } = {},
): ImplicitPair[] {
  const { minCommon = 2, maxPairs = 3, avoid = new Set() } = opts;
  const neigh = new Map<string, Set<string>>();
  for (const l of links) {
    if (!neigh.has(l.source)) neigh.set(l.source, new Set());
    neigh.get(l.source)!.add(l.target);
    if (!neigh.has(l.target)) neigh.set(l.target, new Set());
    neigh.get(l.target)!.add(l.source);
  }
  const direct = new Set<string>();
  for (const l of links) {
    direct.add(`${l.source}\u0000${l.target}`);
    direct.add(`${l.target}\u0000${l.source}`);
  }
  const candidates = names.filter((n) => neigh.has(n) && !avoid.has(n)).slice(0, 60);
  const pairs: ImplicitPair[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (direct.has(`${a}\u0000${b}`)) continue;
      const na = neigh.get(a) || new Set<string>();
      const nb = neigh.get(b) || new Set<string>();
      let common = 0;
      for (const x of na) if (nb.has(x)) common += 1;
      if (common >= minCommon) pairs.push({ a, b, common });
      if (pairs.length >= maxPairs) return pairs;
    }
  }
  return pairs;
}
