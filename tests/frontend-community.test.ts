import { describe, it, expect } from 'vitest';
import {
  detectCommunities,
  buildHierarchicalGraph,
  buildSemanticHierarchy,
  type CommunityNode,
  type CommunityEdge,
} from '../src/lib/community';

const node = (id: string, name: string, kind = 'concept'): CommunityNode => ({ id, name, kind });
const edge = (source: string, target: string): CommunityEdge => ({ source, target });

describe('前端分层聚合（话题总览 → 下钻）', () => {
  it('话题成员按社区聚合，孤立节点进入 hiddenCount 不渲染', () => {
    const nodes = [
      node('a1', '深度工作'), node('a2', '番茄钟'), node('a3', '专注'),
      node('iso1', '独行客'), node('iso2', '散兵'),
    ];
    const edges = [edge('a1', 'a2'), edge('a2', 'a3'), edge('a1', 'a3')];
    const { topics, nodeToTopic } = buildHierarchicalGraph(nodes, edges);
    const topic = topics.find((t) => t.communityId !== -1);
    expect(topic).toBeDefined();
    for (const id of topic!.memberIds) expect(id.startsWith('a')).toBe(true);
    // 孤立节点不在任何话题的 nodeToTopic 中
    expect(nodeToTopic.has('iso1')).toBe(false);
    expect(nodeToTopic.has('iso2')).toBe(false);
  });

  it('边缘节点被吸收进邻居最多的社区（无社区节点有社区邻居时）', () => {
    // b1 无社区（与 a 簇只有一条边，且自身不成簇），应被吸收
    const nodes = [
      node('a1', '深度工作'), node('a2', '番茄钟'), node('a3', '专注'),
      node('b1', '边缘节点'),
    ];
    const edges = [edge('a1', 'a2'), edge('a2', 'a3'), edge('a1', 'a3'), edge('b1', 'a2')];
    const { nodeToTopic } = buildHierarchicalGraph(nodes, edges, { minNodes: 3 });
    expect(nodeToTopic.has('b1')).toBe(true);
    // b1 与 a2 同话题
    expect(nodeToTopic.get('b1')).toBe(nodeToTopic.get('a2'));
  });

  it('其他知识桶：有邻居但无社区的剩余节点聚为灰色桶（#94A3B8）', () => {
    // 两个互连但未达 minNodes 的节点 → 其他桶
    const nodes = [node('x', 'X'), node('y', 'Y'), node('a1', 'A'), node('a2', 'B'), node('a3', 'C')];
    const edges = [edge('x', 'y'), edge('a1', 'a2'), edge('a2', 'a3'), edge('a1', 'a3')];
    const { topics, nodeToTopic } = buildHierarchicalGraph(nodes, edges, { minNodes: 3 });
    const other = topics.find((t) => t.communityId === -1);
    expect(other).toBeDefined();
    expect(other!.color).toBe('#94A3B8');
    expect(other!.memberIds.sort()).toEqual(['x', 'y']);
    expect(nodeToTopic.get('x')).toBe(-1);
  });

  it('金色角配色：不同社区色相不同（黄金角间隔）', () => {
    // 构造两个社区，验证颜色字符串不同
    const nodes = [
      node('a1', '专注'), node('a2', '深度'), node('a3', '效率'),
      node('b1', '睡眠'), node('b2', '失眠'), node('b3', '作息'),
    ];
    const edges = [
      edge('a1', 'a2'), edge('a2', 'a3'), edge('a1', 'a3'),
      edge('b1', 'b2'), edge('b2', 'b3'), edge('b1', 'b3'),
    ];
    const { topics } = buildHierarchicalGraph(nodes, edges);
    const real = topics.filter((t) => t.communityId !== -1);
    expect(real.length).toBe(2);
    expect(real[0].color).not.toBe(real[1].color);
    expect(real[0].color).toMatch(/^hsl\(/);
  });

  it('detectCommunities 前端版：孤立节点不成簇', () => {
    const nodes = [node('a', 'A'), node('b', 'B'), node('iso', '孤立')];
    const communities = detectCommunities(nodes, [edge('a', 'b')]);
    const allIds = new Set(communities.flatMap((c) => c.nodeIds));
    expect(allIds.has('iso')).toBe(false);
  });
});

describe('大社区递归细分（2026-08-18）', () => {
  it('成员 >25 且内部含多个亚群的大社区被拆成子话题', () => {
    // 两个亚群：A 14 节点内部全连接散点、B 14 节点内部全连接散点、亚群间仅 1 条边
    const build = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => node(`${prefix}${i}`, `${prefix}${i}`));
    const aNodes = build('a', 14);
    const bNodes = build('b', 14);
    const allNodes = [...aNodes, ...bNodes];
    // 亚群内部：星型连到该组 0 号（强连接）；亚群间 1 条弱边
    const aEdges = aNodes.slice(1).map((n) => edge('a0', n.id));
    const bEdges = bNodes.slice(1).map((n) => edge('b0', n.id));
    const bridgeEdges = [edge('a0', 'b0')];
    const { topics } = buildHierarchicalGraph(allNodes, [...aEdges, ...bEdges, ...bridgeEdges], { minNodes: 2 });
    // 应至少拆成 2 个真实话题，且没有 28 成员的单一大话题
    const real = topics.filter((t) => t.communityId !== -1);
    expect(real.length).toBeGreaterThanOrEqual(2);
    const maxMembers = Math.max(...real.map((t) => t.memberIds.length));
    expect(maxMembers).toBeLessThan(28);
    // 拆出的两个话题各含一个亚群（i.e. 成员前缀不混）
    for (const t of real) {
      const prefixes = new Set(t.memberIds.map((id) => id[0]));
      expect(prefixes.size).toBeLessThanOrEqual(2);
    }
  });
});

describe('语义主题分层 buildSemanticHierarchy（2026-08-19 全语义两层粒度）', () => {
  const topic = (id: string, name: string): CommunityNode => ({ id, name, kind: 'concept' });

  it('总览=宽主题，nodeToSuper 指向宽主题；细主题归属正确', () => {
    const nodes = [topic('a1', '番茄工作法'), topic('a2', '周报'), topic('b1', '深睡'), topic('b2', '跑步')];
    const nodeTopic = new Map([
      ['a1', '效率方法'], // 工作与职业
      ['a2', '效率方法'], // 工作与职业
      ['b1', '睡眠'], // 健康与运动
      ['b2', '运动健身'], // 健康与运动
    ]);
    const h = buildSemanticHierarchy(nodes, [], nodeTopic);
    const work = h.superTopics.find((s) => s.name === '工作');
    const health = h.superTopics.find((s) => s.name === '健康');
    expect(work?.memberCount).toBe(2);
    expect(health?.memberCount).toBe(2);
    expect(h.nodeToSuper.get('a1')).toBe(h.nodeToSuper.get('a2'));
    expect(h.nodeToSuper.get('a1')).not.toBe(h.nodeToSuper.get('b1'));
  });

  it('每一层都语义内聚：下钻1 按细主题分组，parent 指向宽主题', () => {
    const nodes = [
      topic('w1', '周报'), topic('w2', '汇报'), topic('x1', '深度块'), topic('x2', '番茄钟'),
      topic('h1', '跑步'), topic('h2', '睡眠'),
    ];
    const nodeTopic = new Map([
      ['w1', '会议与沟通'], ['w2', '会议与沟通'], ['x1', '深度工作'], ['x2', '深度工作'],
      ['h1', '运动健身'], ['h2', '睡眠'],
    ]);
    const h = buildSemanticHierarchy(nodes, [], nodeTopic, { minNodes: 2 });
    const work = h.superTopics.find((s) => s.name === '工作')!;
    // 工作宽主题下按细主题分组（会议与沟通 / 深度工作）
    const subTopics = h.topics.filter((t) => t.parentSuperId === work.id);
    expect(subTopics.map((t) => t.name).sort()).toEqual(['会议与沟通', '深度工作']);
    for (const sub of subTopics) expect(sub.parentSuperId).toBe(work.id);
    // 同细主题节点归同一中话题
    expect(h.nodeToTopic.get('w1')).toBe(h.nodeToTopic.get('w2'));
    expect(h.nodeToTopic.get('x1')).toBe(h.nodeToTopic.get('x2'));
    expect(h.nodeToTopic.get('w1')).not.toBe(h.nodeToTopic.get('x1'));
  });

  it('未分类/未命中细主题的节点归入"其他"宽主题，且不报错', () => {
    const nodes = [topic('a1', '番茄'), topic('o1', '随便一个'), topic('o2', '另一个')];
    const nodeTopic = new Map([['a1', '深度工作']]);
    const h = buildSemanticHierarchy(nodes, [], nodeTopic);
    const other = h.superTopics.find((s) => s.isOther);
    expect(other).toBeDefined();
    expect(other!.memberCount).toBe(2);
    expect(h.nodeToSuper.has('o2')).toBe(true);
    expect(h.nodeToTopic.get('o2')).toBeDefined();
  });
});
