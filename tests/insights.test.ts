import { describe, it, expect } from 'vitest';
import {
  splitByWindow,
  buildGraphIndex,
  personalizedPageRank,
  findGraphBridgePaths,
  chainText,
  computeDepthProfile,
  findImplicitPairs,
  type CapturedRow,
  type NodeRow,
  type LinkRow,
} from '../api/_lib/insights';

const captured = (id: string, daysAgo: number, title: string): CapturedRow => ({
  id,
  title,
  tags: [],
  created_at: new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(),
});

describe('时间窗切分', () => {
  it('按边界天数分近窗/远窗（7 天边界）', () => {
    const rows = [captured('r1', 1, '最近'), captured('r2', 6, '边界内'), captured('r3', 10, '较早')];
    const { recent, older } = splitByWindow(rows, 7);
    expect(recent.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(older.map((r) => r.id)).toEqual(['r3']);
  });
});

describe('图谱索引与桥路径', () => {
  const nodes: NodeRow[] = [
    { id: 'n1', name: '加班', kind: 'event', source_captured_ids: ['c1'] },
    { id: 'n2', name: '睡眠不足', kind: 'concept' },
    { id: 'n3', name: '咖啡', kind: 'object', source_captured_ids: ['c2'] },
    { id: 'n4', name: '晨跑', kind: 'event' },
  ];
  const links: LinkRow[] = [
    { source: 'n1', target: 'n2' },
    { source: 'n2', target: 'n3' },
    { source: 'n3', target: 'n4' },
  ];
  const capturedRows: CapturedRow[] = [
    { ...captured('c1', 1, '加班记录'), tags: ['工作'] },
    { ...captured('c2', 2, '咖啡因'), tags: ['健康'] },
  ];

  it('buildGraphIndex 建立节点→捕获与捕获→节点映射（来源为节点 source_captured_ids）', () => {
    const index = buildGraphIndex(nodes, links);
    expect(index.nodeToCaptured.get('n1')).toEqual(new Set(['c1']));
    expect(index.capturedToNodes.get('c2')).toEqual(new Set(['n3']));
  });

  it('二跳桥：A 节点 → 中间节点 → B 节点（mid 不直接关联任一捕获）', () => {
    const index = buildGraphIndex(nodes, links);
    const paths = findGraphBridgePaths(capturedRows, index, 10);
    // n1(加班, c1) → n2(睡眠不足, 无捕获关联) → n3(咖啡, c2)
    const bridge = paths.find((p) => p.nodeA?.id === 'n1' && p.nodeB?.id === 'n3');
    expect(bridge).toBeDefined();
    expect(bridge!.midNode?.id).toBe('n2');
  });

  it('共享标签的捕获不产生桥（避免与 related 规则重复）', () => {
    const index = buildGraphIndex(nodes, links);
    const bothTagged: CapturedRow[] = [
      { ...capturedRows[0], tags: ['工作'] },
      { ...capturedRows[1], tags: ['工作'] },
    ];
    const paths = findGraphBridgePaths(bothTagged, index, 10);
    expect(paths.length).toBe(0);
  });

  it('chainText 生成传导链文案', () => {
    expect(chainText('加班', '睡眠不足', '咖啡')).toBe('「加班」→「睡眠不足」→「咖啡」');
    expect(chainText('加班', null, '咖啡')).toBe('「加班」⇄「咖啡」');
  });
});

describe('Personalized PageRank（P7 图桥）', () => {
  it('从种子沿链衰减：近邻 > 次邻 > 远端', () => {
    // 链：A - B - C - D
    const nodes: NodeRow[] = [
      { id: 'A', name: 'A', kind: 'concept' },
      { id: 'B', name: 'B', kind: 'concept' },
      { id: 'C', name: 'C', kind: 'concept' },
      { id: 'D', name: 'D', kind: 'concept' },
    ];
    const links: LinkRow[] = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
    ];
    const index = buildGraphIndex(nodes, links);
    const rank = personalizedPageRank(index, ['A']);
    expect(rank.get('B')!).toBeGreaterThan(rank.get('C')!);
    expect(rank.get('C')!).toBeGreaterThan(rank.get('D')!);
    // 种子 A（端节点）不低于最远端 D
    expect(rank.get('A')!).toBeGreaterThan(rank.get('D')!);
  });

  it('多种子均分初始权重：对称图两节点分数接近', () => {
    const nodes: NodeRow[] = [
      { id: 'A', name: 'A', kind: 'concept' },
      { id: 'B', name: 'B', kind: 'concept' },
    ];
    const links: LinkRow[] = [{ source: 'A', target: 'B' }];
    const index = buildGraphIndex(nodes, links);
    const rank = personalizedPageRank(index, ['A', 'B']);
    expect(Math.abs(rank.get('A')! - rank.get('B')!)).toBeLessThan(0.02);
  });

  it('不存在的种子不产生贡献（全 0）', () => {
    const nodes: NodeRow[] = [{ id: 'A', name: 'A', kind: 'concept' }];
    const index = buildGraphIndex(nodes, []);
    const rank = personalizedPageRank(index, ['ghost']);
    expect(rank.get('A')).toBe(0);
  });
});

describe('投入深度预测 computeDepthProfile', () => {
  it('记录多但无关联 → 浅（只记没思考）；高度关联 → 深（枢纽）', () => {
    const nodes = [
      { name: '学习方法', sourceCount: 4 },
      { name: '睡眠', sourceCount: 2 },
      { name: '工作', sourceCount: 3 },
      { name: '健康', sourceCount: 1 },
    ];
    const links = [
      { source: '学习方法', target: '专注力' },
      { source: '学习方法', target: '时间' },
      { source: '学习方法', target: '计划' },
      // 「睡眠」记录 2 次但没有任何关联 → 浅
    ];
    const profile = computeDepthProfile(nodes, links);
    // 睡眠：记录 2 次但无直接关联 → 浅；学习方法：degree 3 → 深
    expect(profile.shallow.map((s) => s.name).sort()).toEqual(['工作', '睡眠']);
    expect(profile.deep[0].name).toBe('学习方法');
    expect(profile.deep[0].degree).toBe(3);
  });

  it('阈值可调：shallowMinSource / deepMinDegree', () => {
    const nodes = [{ name: 'X', sourceCount: 2 }];
    const profile = computeDepthProfile(nodes, [], { shallowMinSource: 5, deepMinDegree: 10 });
    // sourceCount 2 < 5 → 不入浅
    expect(profile.shallow).toEqual([]);
    expect(profile.deep).toEqual([]);
  });
});

describe('隐含关联预测 findImplicitPairs', () => {
  it('公共邻居 ≥2 且无直接边 → 预测隐含关联', () => {
    // A、B 都连着 X、Y（公共邻居 2），但 A-B 无直接边
    const names = ['A', 'B', 'X', 'Y'];
    const links = [
      { source: 'A', target: 'X' },
      { source: 'A', target: 'Y' },
      { source: 'B', target: 'X' },
      { source: 'B', target: 'Y' },
    ];
    const pairs = findImplicitPairs(names, links, { minCommon: 2, maxPairs: 1 });
    expect(pairs.length).toBe(1);
    expect(pairs[0].a === 'A' || pairs[0].a === 'B').toBe(true);
    expect(pairs[0].common).toBe(2);
  });

  it('有直接边或公共邻居不足 → 不预测', () => {
    const names = ['A', 'B', 'X'];
    const links = [
      { source: 'A', target: 'X' },
      { source: 'B', target: 'X' }, // 公共邻居只有 1 个 X
    ];
    expect(findImplicitPairs(names, links, { minCommon: 2 }).length).toBe(0);

    const names2 = ['A', 'B', 'X', 'Y'];
    const links2 = [
      { source: 'A', target: 'X' },
      { source: 'A', target: 'Y' },
      { source: 'B', target: 'X' },
      { source: 'B', target: 'Y' },
      { source: 'A', target: 'B' }, // A-B 直接边 → 这对不被预测
    ];
    const pairs2 = findImplicitPairs(names2, links2, { minCommon: 2 });
    // 有直接边的 A-B 不被预测（即使公共邻居够）
    expect(pairs2.some((p) => (p.a === 'A' && p.b === 'B') || (p.a === 'B' && p.b === 'A'))).toBe(false);
  });

  it('avoid 集合排除已有关联概念', () => {
    const pairs = findImplicitPairs(
      ['A', 'B', 'X', 'Y'],
      [
        { source: 'A', target: 'X' },
        { source: 'A', target: 'Y' },
        { source: 'B', target: 'X' },
        { source: 'B', target: 'Y' },
      ],
      { minCommon: 2, avoid: new Set(['A']) },
    );
    expect(pairs.every((p) => p.a !== 'A' && p.b !== 'A')).toBe(true);
  });
});
