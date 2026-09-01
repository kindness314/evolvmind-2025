import { describe, it, expect } from 'vitest';
import { detectCommunities, evolutionOf, describeCommunity, type Community } from '../api/_lib/community';
import type { NodeRow, LinkRow } from '../api/_lib/insights';

const node = (id: string, name: string, opts: Partial<NodeRow> = {}): NodeRow => ({
  id,
  name,
  kind: 'concept',
  ...opts,
});

const link = (source: string, target: string): LinkRow => ({ source, target });

const community = (partial: Partial<Community>): Community => ({
  id: 1,
  nodeIds: [],
  name: 'x',
  nodeCount: 0,
  capturedIds: new Set(),
  recentNodes: 0,
  olderNodes: 0,
  recentCaptures: 0,
  ...partial,
});

describe('服务端社区检测（P2 贪心模块度）', () => {
  it('强连接的两簇各自合并，互不串簇', () => {
    // 簇 A：a1-a2-a3 三角形；簇 B：b1-b2 边；两簇之间无连接
    const nodes = [
      node('a1', '专注'), node('a2', '深度工作'), node('a3', '番茄钟'),
      node('b1', '睡眠'), node('b2', '失眠'),
    ];
    const links = [
      link('a1', 'a2'), link('a2', 'a3'), link('a1', 'a3'),
      link('b1', 'b2'),
    ];
    const communities = detectCommunities(nodes, links);
    expect(communities.length).toBeGreaterThanOrEqual(1);
    // 找到含 a1 的社区，成员应全部来自 A 簇
    const aComm = communities.find((c) => c.nodeIds.includes('a1'));
    expect(aComm).toBeDefined();
    for (const id of aComm!.nodeIds) {
      expect(id.startsWith('a')).toBe(true);
    }
    // 含 b1 的社区成员应全部来自 B 簇
    const bComm = communities.find((c) => c.nodeIds.includes('b1'));
    expect(bComm).toBeDefined();
    for (const id of bComm!.nodeIds) {
      expect(id.startsWith('b')).toBe(true);
    }
  });

  it('自环与重复边被去重，不产生孤点社区', () => {
    const nodes = [node('x', 'X'), node('y', 'Y'), node('iso', '孤立点')];
    const links = [
      link('x', 'x'), // 自环
      link('x', 'y'), link('y', 'x'), // 重复无向边
    ];
    const communities = detectCommunities(nodes, links);
    const allIds = new Set(communities.flatMap((c) => c.nodeIds));
    // 孤立点不应进入任何社区（无社区输出时也符合预期）
    expect(allIds.has('iso')).toBe(false);
    // x/y 应在同一社区（去重后仍有边连接）
    if (communities.length > 0) {
      const comm = communities.find((c) => c.nodeIds.includes('x'));
      expect(comm!.nodeIds).toContain('y');
    }
  });
  it('孤立节点不参与社区（不出现在结果）', () => {
    const nodes = [node('a', 'A'), node('b', 'B'), node('alone', '独行')];
    const links = [link('a', 'b')];
    const communities = detectCommunities(nodes, links);
    const allIds = new Set(communities.flatMap((c) => c.nodeIds));
    expect(allIds.has('alone')).toBe(false);
    expect(allIds.has('a')).toBe(true);
  });

  it('minNodes 过滤小社区', () => {
    const nodes = [node('a', 'A'), node('b', 'B'), node('c', 'C'), node('d', 'D')];
    const links = [link('a', 'b'), link('c', 'd')];
    const strict = detectCommunities(nodes, links, { minNodes: 3 });
    // 两个 2 节点社区都被过滤
    expect(strict.length).toBe(0);
    const loose = detectCommunities(nodes, links, { minNodes: 2 });
    expect(loose.length).toBe(2);
  });
});

describe('社区演化判定', () => {
  it('近窗占比 ≥60% 且 ≥1 → growing', () => {
    expect(evolutionOf(community({ nodeCount: 4, recentNodes: 3, olderNodes: 1 }))).toBe('growing');
  });
  it('近窗为 0 且远窗 ≥2 → shrinking', () => {
    expect(evolutionOf(community({ nodeCount: 5, recentNodes: 0, olderNodes: 5 }))).toBe('shrinking');
  });
  it('其余 → stable', () => {
    expect(evolutionOf(community({ recentNodes: 1, olderNodes: 1 }))).toBe('stable');
    expect(evolutionOf(community({ recentNodes: 0, olderNodes: 1 }))).toBe('stable');
  });
});

describe('社区描述', () => {
  it('包含簇名与节点数', () => {
    const desc = describeCommunity(community({ name: '专注', nodeCount: 4, nodeIds: ['a', 'b', 'c', 'd'] }));
    expect(desc).toContain('专注');
    expect(desc).toContain('4');
  });
});
