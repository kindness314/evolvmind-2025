/**
 * src/lib/community.ts — 前端图谱社区检测（纯函数，与 api/_lib/community.ts 同算法）
 *
 * 用于知识图谱页：全量节点过多时按社区聚合显示（同社区同色系 + 主题簇图例 +
 * 点击聚焦社区子图），把"毛线团"变成可读的认知地图。
 *
 * 设计原则：纯计算、无副作用、无 IO。
 */

export interface CommunityNode {
  id: string;
  name: string;
  kind?: string;
}

export interface CommunityEdge {
  source: string;
  target: string;
}

export interface FrontendCommunity {
  id: number;
  nodeIds: string[];
  /** 代表性名称：度数最高的节点名 */
  name: string;
  nodeCount: number;
}

/**
 * 贪心模块度社区合并（Clauset-Newman-Moore 简化版）。
 * 初始每节点一社区，反复合并 ΔQ 最大的社区对直到无正增益。
 * 复杂度优化（大数据量友好）：
 *  - 只让有边的节点参与（孤立节点不成簇）
 *  - 每轮只遍历边收集"跨社区对"，而不是全对扫描
 *  - 迭代上限防病态图
 */
export function detectCommunities(
  nodes: CommunityNode[],
  edges: CommunityEdge[],
  opts: { minNodes?: number } = {},
): FrontendCommunity[] {
  const nodeSet = new Set(nodes.map((n) => n.id));
  // 无向边去重
  const seen = new Set<string>();
  const dedupEdges: Array<[string, string]> = [];
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue;
    const key = e.source < e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupEdges.push([e.source, e.target]);
  }
  const m = dedupEdges.length;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // 度数
  const degree = new Map<string, number>();
  for (const [a, b] of dedupEdges) {
    degree.set(a, (degree.get(a) || 0) + 1);
    degree.set(b, (degree.get(b) || 0) + 1);
  }

  // 只让有边的节点参与社区合并（孤立节点不成簇）
  const activeNodes = nodes.filter((n) => (degree.get(n.id) || 0) > 0);
  if (activeNodes.length === 0) return [];

  // 初始：每节点一社区
  let nextCompId = 0;
  const compNodes = new Map<number, Set<string>>();
  const compNodeIndex = new Map<string, number>(); // nodeId -> compId
  for (const n of activeNodes) {
    compNodes.set(nextCompId, new Set([n.id]));
    compNodeIndex.set(n.id, nextCompId);
    nextCompId += 1;
  }

  const degreeSumOf = (compId: number): number => {
    const ids = compNodes.get(compId);
    if (!ids) return 0;
    let sum = 0;
    for (const id of ids) sum += degree.get(id) || 0;
    return sum;
  };

  // 增量式贪心合并：只检查"两端在不同社区"的边，聚合社区对
  // ΔQ 符号 = e_AB·2m - sumA·sumB
  let improved = true;
  let iterations = 0;
  const MAX_ITERATIONS = 200;
  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations += 1;
    const pairGain = new Map<string, { a: number; b: number; eAB: number }>();
    for (const [a, b] of dedupEdges) {
      const ca = compNodeIndex.get(a);
      const cb = compNodeIndex.get(b);
      if (ca === undefined || cb === undefined || ca === cb) continue;
      const key = ca < cb ? `${ca}\u0000${cb}` : `${cb}\u0000${ca}`;
      const cur = pairGain.get(key);
      if (cur) {
        cur.eAB += 1;
      } else {
        pairGain.set(key, { a: Math.min(ca, cb), b: Math.max(ca, cb), eAB: 1 });
      }
    }
    let bestKey: string | null = null;
    let bestGain = 0;
    for (const [key, p] of pairGain) {
      const g = p.eAB * 2 * m - degreeSumOf(p.a) * degreeSumOf(p.b);
      if (g > bestGain) {
        bestGain = g;
        bestKey = key;
      }
    }
    if (bestKey) {
      const [a, b] = bestKey.split('\u0000').map(Number);
      const merged = new Set([...compNodes.get(a)!, ...compNodes.get(b)!]);
      compNodes.delete(a);
      compNodes.delete(b);
      compNodes.set(nextCompId, merged);
      for (const id of merged) compNodeIndex.set(id, nextCompId);
      nextCompId += 1;
      improved = true;
    }
  }

  const minNodes = opts.minNodes ?? 2;
  const out: FrontendCommunity[] = [];
  for (const nodeIds of compNodes.values()) {
    const list = [...nodeIds].map((id) => nodeById.get(id)).filter((n): n is CommunityNode => Boolean(n));
    let name = '';
    let bestDeg = -1;
    for (const n of list) {
      const d = degree.get(n.id) || 0;
      if (d > bestDeg) {
        bestDeg = d;
        name = n.name;
      }
    }
    if (!name) name = list[0]?.name || '未命名簇';
    out.push({ id: nextCompId, nodeIds: [...nodeIds], name, nodeCount: list.length });
    nextCompId += 1;
  }

  return out
    .filter((c) => c.nodeCount >= minNodes)
    .sort((a, b) => b.nodeCount - a.nodeCount);
}

/**
 * 为社区分配稳定的色相（Hue），同社区同色系、不同社区可区分。
 * 返回: nodeId → { communityId, communityName, color }（未入社区的节点返回 null）
 */
export function buildCommunityMap(
  nodes: CommunityNode[],
  edges: CommunityEdge[],
): { nodeCommunity: Map<string, { id: number; name: string; color: string }>; communities: FrontendCommunity[] } {
  const communities = detectCommunities(nodes, edges);
  const nodeCommunity = new Map<string, { id: number; name: string; color: string }>();
  const HUE_STEP = 360 / Math.max(1, communities.length);
  communities.forEach((c, idx) => {
    const hue = (idx * HUE_STEP + 30) % 360;
    for (const id of c.nodeIds) {
      nodeCommunity.set(id, { id: c.id, name: c.name, color: `hsl(${hue}, 55%, 62%)` });
    }
  });
  return { nodeCommunity, communities };
}

// ---------------------------------------------------------------------------
// 分层聚合图数据（供 KnowledgePage 直接消费）
// ---------------------------------------------------------------------------

export interface TopicMember {
  id: string;
  name: string;
  kind?: string;
}

/** 大话题（第一层）——一次性社区检测得到；其下细分出多个中话题 */
export interface SuperTopic {
  id: number;
  name: string;
  color: string;
  /** 该大话题下的中话题 id 列表 */
  subTopicIds: number[];
  /** 归属该大话题的全部节点数（吸收边缘节点后） */
  memberCount: number;
  /** 其他知识桶 */
  isOther: boolean;
}

export interface TopicAggregate {
  /** 中话题 id（other 桶为 -1） */
  communityId: number;
  /** 所属大话题 id（other 桶无） */
  parentSuperId?: number;
  name: string;
  color: string;
  /** 中话题包含的全部节点（吸收边缘节点后） */
  memberIds: string[];
  /** 中话题大节点的展示成员（最多 N 个，用于图例） */
  sampleNames: string[];
  /** 完全孤立、未进任何话题的节点数（收纳计数，不渲染） */
  hiddenCount: number;
}

export interface HierarchicalGraph {
  /** 大话题（第一层）：总览层渲染 */
  superTopics: SuperTopic[];
  /** 中话题（第二层）：下钻进大话题后渲染；节点精确归属到中话题 */
  topics: TopicAggregate[];
  /** nodeId → 中话题 id（完全孤立节点不在 map 中） */
  nodeToTopic: Map<string, number>;
  /** nodeId → 大话题 id */
  nodeToSuper: Map<string, number>;
}

/**
 * 构建分层聚合图：
 * 1. 社区检测（有边节点）
 * 2. 边缘吸收：社区外但有社区邻居的节点并入邻居最多的社区
 * 3. 剩余节点聚合为"其他知识"话题桶；完全孤立节点只计数（hiddenCount），不参与渲染
 */
export function buildHierarchicalGraph(
  nodes: CommunityNode[],
  edges: CommunityEdge[],
  opts: { minNodes?: number } = {},
): HierarchicalGraph {
  const minNodes = opts.minNodes ?? 2;
  const GOLDEN_ANGLE = 137.50776405003785;
  const OTHER_SUPER = -1; // 大话题层"其他知识"桶
  const OTHER_TOPIC = -1; // 中话题层"其他知识"桶

  // 邻接表
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  // 1. 大话题（第一层）：一次性社区检测
  const rawSupers = detectCommunities(nodes, edges, { minNodes });
  const superMembers = new Map<number, Set<string>>();
  const superName = new Map<number, string>();
  rawSupers.forEach((c, superId) => {
    superMembers.set(superId, new Set(c.nodeIds));
    superName.set(superId, c.name);
  });

  // 2. 每个大话题细分出中话题（第二层）
  const nodeToTopic = new Map<string, number>();
  const nodeToSuper = new Map<string, number>();
  const topicMembers = new Map<number, Set<string>>();
  const topicName = new Map<number, string>();
  const topicParent = new Map<number, number>(); // 中话题 id -> 大话题 id

  const RECURSE_LIMIT = 25;
  let topicSeq = 0;
  for (const [superId, superIds] of superMembers) {
    const supIds = [...superIds];
    const RECURSE_LIMIT_ = RECURSE_LIMIT;
    if (supIds.length > RECURSE_LIMIT_) {
      const idSet = new Set(supIds);
      const subNodes = nodes.filter((n) => idSet.has(n.id));
      const subEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
      const subs = detectCommunities(subNodes, subEdges, { minNodes: 3 });
      const valid = subs.filter((s) => s.nodeCount >= 2);
      if (valid.length >= 2) {
        for (const s of valid) {
          topicMembers.set(topicSeq, new Set(s.nodeIds));
          topicName.set(topicSeq, s.name);
          topicParent.set(topicSeq, superId);
          for (const id of s.nodeIds) {
            nodeToTopic.set(id, topicSeq);
            nodeToSuper.set(id, superId);
          }
          topicSeq += 1;
        }
        continue;
      }
    }
    // 大话题整体作为一个中话题
    topicMembers.set(topicSeq, new Set(supIds));
    topicName.set(topicSeq, superName.get(superId) || '未命名');
    topicParent.set(topicSeq, superId);
    for (const id of supIds) {
      nodeToTopic.set(id, topicSeq);
      nodeToSuper.set(id, superId);
    }
    topicSeq += 1;
  }

  // 3. 边缘吸收：社区外但有社区邻居的节点并入邻居最多的中话题
  for (const n of nodes) {
    if (nodeToTopic.has(n.id)) continue;
    const nbs = adj.get(n.id);
    if (!nbs || nbs.size === 0) continue;
    const counts = new Map<number, number>();
    for (const nb of nbs) {
      const tid = nodeToTopic.get(nb);
      if (tid !== undefined) counts.set(tid, (counts.get(tid) || 0) + 1);
    }
    if (counts.size === 0) continue;
    let best: number | null = null;
    let bestCount = 0;
    for (const [tid, cnt] of counts) {
      if (cnt > bestCount) {
        bestCount = cnt;
        best = tid;
      }
    }
    if (best !== null) {
      const parent = topicParent.get(best);
      nodeToTopic.set(n.id, best);
      topicMembers.get(best)!.add(n.id);
      if (parent !== undefined) nodeToSuper.set(n.id, parent);
    }
  }

  // 4. 剩余社区外节点 → 其他桶；完全孤立节点计数
  let otherHidden = 0;
  const otherIds = new Set<string>();
  for (const n of nodes) {
    if (nodeToTopic.has(n.id)) continue;
    const nbs = adj.get(n.id);
    if (!nbs || nbs.size === 0) {
      otherHidden += 1;
    } else {
      otherIds.add(n.id);
    }
  }
  if (otherIds.size > 0) {
    topicMembers.set(OTHER_TOPIC, otherIds);
    topicName.set(OTHER_TOPIC, '其他知识');
    for (const id of otherIds) {
      nodeToTopic.set(id, OTHER_TOPIC);
      nodeToSuper.set(id, OTHER_SUPER);
    }
  }

  // 5. 组装 topics（中话题）：颜色继承所属大话题色相，明度按父内序号错开
  const topics: TopicAggregate[] = [];
  const subHasOther = topicMembers.has(OTHER_TOPIC);
  for (const [tid, memberIds] of topicMembers) {
    if (tid !== OTHER_TOPIC && memberIds.size < minNodes) continue;
    const parent = topicParent.get(tid);
    let hue = parent !== undefined ? ((parent * GOLDEN_ANGLE) % 360) : 0;
    if (tid === OTHER_TOPIC) hue = 0;
    const lightness = 44 + Math.abs(tid % 3) * 10;
    const sampleNames = [...memberIds]
      .map((id) => nodes.find((nd) => nd.id === id)?.name)
      .filter((nm): nm is string => Boolean(nm))
      .slice(0, 4);
    topics.push({
      communityId: tid,
      parentSuperId: parent,
      name: topicName.get(tid) || '未命名',
      color: tid === OTHER_TOPIC ? '#94A3B8' : `hsl(${hue.toFixed(1)}, 65%, ${lightness}%)`,
      memberIds: [...memberIds],
      sampleNames,
      hiddenCount: tid === OTHER_TOPIC ? otherHidden : 0,
    });
  }

  // 6. 组装 superTopics（大话题，第一层）
  const superTopics: SuperTopic[] = [];
  for (const [superId, members] of superMembers) {
    // memberCount 必须包含边缘吸收+其他桶回填后的真实成员数（不是原始社区大小）
    const subTopics = topics.filter((t) => t.parentSuperId === superId);
    const subTopicIds = subTopics.map((t) => t.communityId);
    const memberCount = subTopics.reduce((sum, t) => sum + t.memberIds.length + t.hiddenCount, 0) || members.size;
    const hue = (superId * GOLDEN_ANGLE) % 360;
    superTopics.push({
      id: superId,
      name: superName.get(superId) || '未命名',
      color: `hsl(${hue.toFixed(1)}, 65%, 52%)`,
      subTopicIds,
      memberCount,
      isOther: false,
    });
  }
  if (subHasOther) {
    const otherTopic = topics.find((t) => t.communityId === OTHER_TOPIC);
    superTopics.push({
      id: OTHER_SUPER,
      name: '其他知识',
      color: '#94A3B8',
      subTopicIds: [OTHER_TOPIC],
      memberCount: (otherTopic?.memberIds.length || 0) + (otherTopic?.hiddenCount || 0),
      isOther: true,
    });
  }

  return { superTopics, topics, nodeToTopic, nodeToSuper };
}

// ---------------------------------------------------------------------------
// 语义主题分层（2026-08-19）：总览按语义主题目录（LLM 分类），主题内按图社区细分
// ---------------------------------------------------------------------------

/**
 * 语义主题目录（与 api/graph/topicize.ts TOPIC_CATEGORIES 保持一致）。
 * 排序即总览颜色/顺序依据，故优先级高者在前。
 */
export const SEMANTIC_TOPIC_ORDER = [
  '学习',
  '工作',
  '健康',
  '家庭',
  '生活',
  '技术',
  '财务',
  '社交',
  '心理',
  '认知',
  '兴趣',
  '其他',
] as const;

/**
 * 细主题 → 宽主题 映射（2026-08-19 全语义两层粒度）。
 * 总览按宽主题（SEMANTIC_TOPIC_ORDER），下钻1 按细主题；成员在最里层。
 * 节点只存"细主题"，宽主题由本映射推导。
 * 与 api/graph/topicize.ts 的目录保持一致。
 */
export interface FineTopic {
  fine: string;
  broad: string;
}

export const SEMANTIC_FINE_TOPICS: FineTopic[] = [
  { fine: '学习方法', broad: '学习' },
  { fine: '知识管理', broad: '学习' },
  { fine: '笔记与整理', broad: '学习' },
  { fine: '阅读与论文', broad: '学习' },
  { fine: '复习与记忆', broad: '学习' },
  { fine: '教育课程', broad: '学习' },
  { fine: '深度工作', broad: '工作' },
  { fine: '专注力', broad: '工作' },
  { fine: '时间管理', broad: '工作' },
  { fine: '效率方法', broad: '工作' },
  { fine: '会议与沟通', broad: '工作' },
  { fine: '项目管理', broad: '工作' },
  { fine: '职业发展', broad: '工作' },
  { fine: '工作节奏与加班', broad: '工作' },
  { fine: '写作', broad: '工作' },
  { fine: '睡眠', broad: '健康' },
  { fine: '运动健身', broad: '健康' },
  { fine: '饮食营养', broad: '健康' },
  { fine: '身体保养', broad: '健康' },
  { fine: '作息习惯', broad: '健康' },
  { fine: '育儿', broad: '家庭' },
  { fine: '喂养与辅食', broad: '家庭' },
  { fine: '家庭关系', broad: '家庭' },
  { fine: '亲子互动', broad: '家庭' },
  { fine: '极简生活', broad: '生活' },
  { fine: '消费观念', broad: '生活' },
  { fine: '日常安排', broad: '生活' },
  { fine: '家务与整理', broad: '生活' },
  { fine: '居家环境', broad: '生活' },
  { fine: '前端开发', broad: '技术' },
  { fine: '后端开发', broad: '技术' },
  { fine: '数据库', broad: '技术' },
  { fine: '部署与运维', broad: '技术' },
  { fine: 'AI工具', broad: '技术' },
  { fine: '软件工程', broad: '技术' },
  { fine: '储蓄', broad: '财务' },
  { fine: '预算', broad: '财务' },
  { fine: '投资', broad: '财务' },
  { fine: '收入来源', broad: '财务' },
  { fine: '沟通技巧', broad: '社交' },
  { fine: '人际关系', broad: '社交' },
  { fine: '社交活动', broad: '社交' },
  { fine: '情绪管理', broad: '心理' },
  { fine: '压力与焦虑', broad: '心理' },
  { fine: '拖延', broad: '心理' },
  { fine: '习惯与动力', broad: '心理' },
  { fine: '心理成长', broad: '心理' },
  { fine: '思维方式', broad: '认知' },
  { fine: '认知效率', broad: '认知' },
  { fine: '决策', broad: '认知' },
  { fine: '批判思维', broad: '认知' },
  { fine: '元认知', broad: '认知' },
  { fine: '宠物', broad: '兴趣' },
  { fine: '美食', broad: '兴趣' },
  { fine: '旅行', broad: '兴趣' },
  { fine: '游戏', broad: '兴趣' },
  { fine: '休闲', broad: '兴趣' },
  { fine: '其他', broad: '其他' },
];

/**
 * 全语义话题总览（两层粒度，2026-08-19）：
 * - superTopics（总览）= 宽主题（SEMANTIC_TOPIC_ORDER）
 * - topics（下钻1）= 细主题（SEMANTIC_FINE_TOPICS），parentSuperId = 所属宽主题
 * - 成员在最里层。完全由节点语义分类驱动，不依赖图结构 → 每层语义内聚。
 * 未分类/未命中目录的节点回退"其他"。
 * 输出形状与 buildHierarchicalGraph 完全一致，供 displayGraphData 复用。
 */
export function buildSemanticHierarchy(
  _nodes: CommunityNode[],
  _edges: CommunityEdge[],
  nodeTopic: Map<string, string>,
  _opts: { minNodes?: number } = {},
): HierarchicalGraph {
  const GOLDEN_ANGLE = 137.50776405003785;
  const broadOrder = SEMANTIC_TOPIC_ORDER as readonly string[];
  const OTHER = '其他';
  const fineToBroad = new Map(SEMANTIC_FINE_TOPICS.map((f) => [f.fine, f.broad]));

  // 固定目录序 id
  const broadIndex = new Map<string, number>();
  for (const b of broadOrder) if (!broadIndex.has(b)) broadIndex.set(b, broadIndex.size);
  const fineIndex = new Map<string, number>();
  for (const f of SEMANTIC_FINE_TOPICS) if (!fineIndex.has(f.fine)) fineIndex.set(f.fine, fineIndex.size);

  const superMembers = new Map<number, Set<string>>();
  const topicMembers = new Map<number, Set<string>>();
  const topicParent = new Map<number, number>();
  for (const [b, idx] of broadIndex) superMembers.set(idx, new Set());
  for (const [f, idx] of fineIndex) {
    topicMembers.set(idx, new Set());
    topicParent.set(idx, broadIndex.get(fineToBroad.get(f) || OTHER)!);
  }

  const nodeToSuper = new Map<string, number>();
  const nodeToTopic = new Map<string, number>();
  for (const n of _nodes) {
    const fine = nodeTopic.get(n.id);
    const broad = fine !== undefined ? fineToBroad.get(fine) : undefined;
    if (!fine || !broad || !fineIndex.has(fine)) {
      const bIdx = broadIndex.get(OTHER)!;
      const fIdx = fineIndex.get(OTHER)!;
      superMembers.get(bIdx)!.add(n.id);
      topicMembers.get(fIdx)!.add(n.id);
      nodeToSuper.set(n.id, bIdx);
      nodeToTopic.set(n.id, fIdx);
      continue;
    }
    const bIdx = broadIndex.get(broad)!;
    const fIdx = fineIndex.get(fine)!;
    superMembers.get(bIdx)!.add(n.id);
    topicMembers.get(fIdx)!.add(n.id);
    nodeToSuper.set(n.id, bIdx);
    nodeToTopic.set(n.id, fIdx);
  }

  const topics: TopicAggregate[] = [];
  const superTopics: SuperTopic[] = [];
  const colors = new Map<number, string>();
  for (const [b, idx] of broadIndex) {
    const members = superMembers.get(idx)!;
    if (members.size === 0) continue;
    const hue = (idx * GOLDEN_ANGLE) % 360;
    colors.set(idx, `hsl(${hue.toFixed(1)}, 65%, 52%)`);
    const subTopicIds = [...topicParent.entries()].filter(([, p]) => p === idx).map(([t]) => t);
    superTopics.push({ id: idx, name: b, color: colors.get(idx)!, subTopicIds, memberCount: members.size, isOther: b === OTHER });
  }
  for (const [f, idx] of fineIndex) {
    const tmembers = topicMembers.get(idx)!;
    if (tmembers.size === 0) continue;
    const parent = topicParent.get(idx)!;
    const parentColor = colors.get(parent);
    const hue = parentColor !== undefined ? Number.parseFloat(parentColor.replace(/[^\d.]/g, '')) : 0;
    const lightness = 44 + Math.abs(idx % 3) * 10;
    const sampleNames = [...tmembers]
      .map((id) => _nodes.find((nd) => nd.id === id)?.name)
      .filter((nm): nm is string => Boolean(nm))
      .slice(0, 4);
    topics.push({
      communityId: idx,
      parentSuperId: parent,
      name: f,
      color: parent === broadIndex.get(OTHER) ? '#94A3B8' : `hsl(${hue.toFixed(1)}, 65%, ${lightness}%)`,
      memberIds: [...tmembers],
      sampleNames,
      hiddenCount: 0,
    });
  }

  return { superTopics, topics, nodeToTopic, nodeToSuper };
}
