/**
 * src/lib/topicLayout.ts — 同一层级主题按关联度聚类排布（2026-08-19，无外部依赖）
 *
 * 用户反馈：主题总览/下钻节点"没严格按层级排布、像按顺序"。
 * 对聚合图（主题节点 + 跨主题聚合边）跑一个轻量力导向（斥力 + 弹簧 + 居心），
 * 使**有边关联的主题聚在一起**、无关联的散开，作为初始坐标替代固定环序。
 * 同一层节点少（10~20 个），逐 render 计算成本可忽略。
 */

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface LayoutLink {
  source: string;
  target: string;
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function canvasScale(count: number): number {
  return Math.max(120, Math.min(260, 60 + Math.sqrt(count) * 34));
}

/**
 * 计算主题节点聚类坐标（与 nodeIds 同序返回 {x, y}）。
 * @param nodeIds  主题节点 id
 * @param links    跨主题聚合边（source/target 为 nodeId）
 */
export function clusteredTopicLayout(nodeIds: string[], links: LayoutLink[]): LayoutNode[] {
  if (nodeIds.length === 0) return [];
  const n = nodeIds.length;
  const nodeList: SimNode[] = nodeIds.map((id, i) => {
    // 初始随机散开，避免全叠原点
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = 8 + (i % 5) * 3;
    return { id, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 };
  });
  const index = new Map(nodeList.map((nd) => [nd.id, nd]));
  const edgeList = links
    .filter((l) => l.source !== l.target && index.has(l.source) && index.has(l.target))
    .map((l) => [index.get(l.source)!, index.get(l.target)!]);

  const repulsion = 260 + n * 8; // 斥力系数
  const springLen = 46; // 弹簧自然长
  const springK = 0.05; // 弹力系数
  const centerK = 0.02;
  const damping = 0.82;

  for (let iter = 0; iter < 150; iter += 1) {
    // 斥力（两两）
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = nodeList[i];
        const b = nodeList[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) || 1;
        const f = repulsion / (d2 + 40);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    // 弹簧（有边相吸）
    for (const [a, b] of edgeList) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (d - springLen) * springK;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // 居心 + 阻尼
    for (const nd of nodeList) {
      nd.vx += -nd.x * centerK;
      nd.vy += -nd.y * centerK;
      nd.x += nd.vx;
      nd.y += nd.vy;
      nd.vx *= damping;
      nd.vy *= damping;
    }
  }

  // 缩放到画布尺度并居中
  const xs = nodeList.map((nd) => nd.x);
  const ys = nodeList.map((nd) => nd.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const k = canvasScale(n) / Math.max(spanX, spanY);
  return nodeList.map((nd) => ({
    id: nd.id,
    x: (nd.x - (minX + maxX) / 2) * k,
    y: (nd.y - (minY + maxY) / 2) * k,
  }));
}
