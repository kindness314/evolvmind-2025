/**
 * api/_lib/community.ts — 图谱社区检测（P2 总结社区化）
 *
 * 借鉴 GraphRAG 的 Leiden 社区检测思路，用贪心模块度合并（Clauset-Newman-Moore
 * 简化版）把周期内的节点+边图谱切成主题簇，每个簇代表用户生活/知识的一个
 * 聚合主题，供 summarize 生成"社区摘要"与"社区演化"。
 *
 * 设计原则：纯计算、无副作用、无 IO，便于单测。
 */
import { isTrivialNodeName } from './noise.js';
import type { NodeRow, LinkRow } from './insights.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface Community {
  id: number;
  nodeIds: string[];
  /** 代表性名称：社区内度数最高的实质节点名 */
  name: string;
  nodeCount: number;
  /** 社区节点关联的捕获 ID（去重） */
  capturedIds: Set<string>;
  /** 近窗（如周期一半内）创建的节点数 vs 更早的节点数，用于演化判断 */
  recentNodes: number;
  olderNodes: number;
  /** 近窗节点关联的捕获数（去重）——"扩张 X 条记录关联"的依据 */
  recentCaptures: number;
}

export interface DetectOptions {
  /** 演化窗口边界（天）：近窗 = 最近 N 天内创建的节点 */
  recentBoundaryDays?: number;
  /** 只保留达到最小节点数的社区（避免孤立节点刷屏），默认 2 */
  minNodes?: number;
}

// ---------------------------------------------------------------------------
// 社区检测（贪心模块度）
// ---------------------------------------------------------------------------

/**
 * 在节点+无向边上做贪心模块度社区合并。
 * 初始每节点一社区，反复合并 ΔQ 最大的社区对，直到没有正增益。
 * ΔQ = e_AB - a_A·a_B（e_AB=社区间边数/2m，a=社区度数/2m）。
 */
export function detectCommunities(
  nodes: NodeRow[],
  links: LinkRow[],
  opts: DetectOptions = {},
): Community[] {
  const { recentBoundaryDays = 7 } = opts;

  const nodeSet = new Set(nodes.map((n) => n.id));
  // 无向边去重
  const edges: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (l.source === l.target) continue;
    if (!nodeSet.has(l.source) || !nodeSet.has(l.target)) continue;
    const key = l.source < l.target ? `${l.source}\u0000${l.target}` : `${l.target}\u0000${l.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([l.source, l.target]);
  }
  const m = edges.length;

  const nodeById = new Map<string, NodeRow>();
  for (const n of nodes) nodeById.set(n.id, n);

  // 度数
  const degree = new Map<string, number>();
  for (const [a, b] of edges) {
    degree.set(a, (degree.get(a) || 0) + 1);
    degree.set(b, (degree.get(b) || 0) + 1);
  }

  // 初始：每节点一社区
  let nextCompId = 0;
  const compOf = new Map<string, number>();
  const compNodes = new Map<number, Set<string>>();
  for (const n of nodes) {
    compOf.set(n.id, nextCompId);
    compNodes.set(nextCompId, new Set([n.id]));
    nextCompId += 1;
  }

  // 模块度增益：两社区合并的 ΔQ（符号正确即可，m 常数可忽略）
  const gain = (ca: Set<string>, cb: Set<string>): number => {
    let eAB = 0;
    for (const [a, b] of edges) {
      if ((ca.has(a) && cb.has(b)) || (ca.has(b) && cb.has(a))) eAB += 1;
    }
    if (eAB === 0) return 0;
    let sumA = 0;
    let sumB = 0;
    for (const id of ca) sumA += degree.get(id) || 0;
    for (const id of cb) sumB += degree.get(id) || 0;
    // ΔQ = e_AB/(2m) - (sumA/(2m))·(sumB/(2m))；乘 (2m)² 保留符号：e_AB·2m - sumA·sumB
    return eAB * 2 * m - sumA * sumB;
  };

  // 贪心合并直到无正增益
  let improved = true;
  while (improved) {
    improved = false;
    const ids = [...compNodes.keys()];
    let bestGain = 0;
    let bestPair: [number, number] | null = null;
    for (let i = 0; i < ids.length; i += 1) {
      const ca = compNodes.get(ids[i])!;
      for (let j = i + 1; j < ids.length; j += 1) {
        const g = gain(ca, compNodes.get(ids[j])!);
        if (g > bestGain) {
          bestGain = g;
          bestPair = [ids[i], ids[j]];
        }
      }
    }
    if (bestPair) {
      const [a, b] = bestPair;
      const merged = new Set([...compNodes.get(a)!, ...compNodes.get(b)!]);
      compNodes.delete(a);
      compNodes.delete(b);
      compNodes.set(nextCompId, merged);
      for (const id of merged) compOf.set(id, nextCompId);
      nextCompId += 1;
      improved = true;
    }
  }

  // 演化窗口
  const boundary = Date.now() - recentBoundaryDays * 24 * 3600 * 1000;

  const out: Community[] = [];
  for (const nodeIds of compNodes.values()) {
    const list = [...nodeIds]
      .map((id) => nodeById.get(id))
      .filter((n): n is NodeRow => Boolean(n));

    const capturedIds = new Set<string>();
    let recentNodes = 0;
    let olderNodes = 0;
    const recentCaptures = new Set<string>();
    for (const n of list) {
      const t = n.created_at ? new Date(n.created_at).getTime() : Number.NaN;
      const isRecent = Number.isFinite(t) && t >= boundary;
      if (isRecent) recentNodes += 1;
      else olderNodes += 1;
      if (Array.isArray(n.source_captured_ids)) {
        for (const cid of n.source_captured_ids) {
          if (typeof cid !== 'string') continue;
          capturedIds.add(cid);
          if (isRecent) recentCaptures.add(cid);
        }
      }
    }

    // 代表性名称：度数最高的实质节点（非停用词）
    let name = '';
    let bestDeg = -1;
    for (const n of list) {
      if (isTrivialNodeName(n.name)) continue;
      const d = degree.get(n.id) || 0;
      if (d > bestDeg) {
        bestDeg = d;
        name = n.name;
      }
    }
    if (!name) name = list[0]?.name || '未命名簇';

    out.push({
      id: nextCompId,
      nodeIds: [...nodeIds],
      name,
      nodeCount: list.length,
      capturedIds,
      recentNodes,
      olderNodes,
      recentCaptures: recentCaptures.size,
    });
    nextCompId += 1;
  }

  const minNodes = opts.minNodes ?? 2;
  return out
    .filter((c) => c.nodeCount >= minNodes)
    .sort((a, b) => b.nodeCount - a.nodeCount || b.capturedIds.size - a.capturedIds.size);
}

// ---------------------------------------------------------------------------
// 社区演化判定
// ---------------------------------------------------------------------------

export type CommunityEvolution = 'growing' | 'shrinking' | 'stable';

/** 近窗节点占比 ≥60% 且 ≥1 → 扩张；近窗为 0 且远窗 ≥2 → 收缩；否则稳定 */
export function evolutionOf(c: Community): CommunityEvolution {
  if (c.nodeCount === 0) return 'stable';
  if (c.recentNodes >= 1 && c.recentNodes / c.nodeCount >= 0.6) return 'growing';
  if (c.recentNodes === 0 && c.olderNodes >= 2) return 'shrinking';
  return 'stable';
}

/** 社区确定性描述：簇名 + 节点数 + 关联捕获数 + 演化 */
export function describeCommunity(c: Community): string {
  const evo = evolutionOf(c);
  const evoText =
    evo === 'growing'
      ? `，正在扩张（近窗新增 ${c.recentNodes} 个节点、${c.recentCaptures} 条记录关联）`
      : evo === 'shrinking'
        ? `，正在收缩（近窗没有新增节点）`
        : '，保持平稳';
  return `「${c.name}」：${c.nodeCount} 个节点、关联 ${c.capturedIds.size} 条记录${evoText}`;
}
