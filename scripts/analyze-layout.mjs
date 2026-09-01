/**
 * scripts/analyze-layout.mjs — 图谱布局质量分析器（视觉模拟）
 *
 * 复现 KnowledgePage 的前端链路（不依赖浏览器）：
 *   1. 从 Supabase 拉取与页面相同的节点/边
 *   2. 运行 buildHierarchicalGraph（话题聚合）
 *   3. 按 displayGraphData 构造总览层/下钻层节点与边
 *   4. 用 d3-force（与 force-graph 相同的力导向参数 + 碰撞力）模拟到静止
 *   5. 归一化布局到画布尺度（模拟 handleEngineStop 的 normalizeAggregateLayout）
 *   6. 量化布局质量：bbox、节点重叠、标签可读性、裁剪、色板区分度
 *
 * 用法：bun scripts/analyze-layout.mjs [--drill] [--json]
 */
import { buildHierarchicalGraph } from '../src/lib/community.ts';
import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d';

const PROJECT_ID = 'wocchwrvlhqdwtvfwfab';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvY2Nod3J2bGhxZHd0dmZ3ZmFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODQ1ODIsImV4cCI6MjA5MTA2MDU4Mn0.BVlVGSpKth0t6kFSAoZSU0N_DzAYpWGAMIn4RhxRswk';
const BASE = `https://${PROJECT_ID}.supabase.co/rest/v1/`;

async function fetchTable(table, select) {
  const res = await fetch(`${BASE}${table}?select=${encodeURIComponent(select)}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}
function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
function colorToRgb(color) {
  if (color.startsWith('#')) return hexToRgb(color);
  const m = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/.exec(color);
  if (m) return hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return [128, 128, 128];
}
function colorDist(c1, c2) {
  const [r1, g1, b1] = colorToRgb(c1);
  const [r2, g2, b2] = colorToRgb(c2);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// 与 KnowledgePage forceTuning 相同的参数
function forceTuning(n) {
  const large = n > 300, medium = n > 80;
  return {
    warmupTicks: large ? 40 : medium ? 80 : 120,
    cooldownTicks: large ? 120 : medium ? 200 : 300,
    velocityDecay: large ? 0.5 : medium ? 0.4 : 0.3,
    alphaDecay: large ? 0.045 : medium ? 0.03 : 0.022,
    chargeStrength: n > 300 ? -80 : n > 80 ? -160 : -280,
  };
}

function topicRadius(members) {
  const m = members && members > 0 ? members : 3;
  return Math.max(12, Math.min(21, 11 + 8 * (Math.log2(m + 1) / Math.log2(45))));
}
function memberRadius(val) { return Math.max(5, Math.min(10, 4 + Math.sqrt(val || 6) * 1.5)); }
// 与 KnowledgePage nodeRenderRadius 一致（memberCount 驱动；其他知识桶固定 12）
function renderRadius(n) {
  if (n.isTopic) return n.isDimmed ? 12 : topicRadius(n.memberCount ?? n.val ?? 3);
  return memberRadius(n.val);
}

function simulate(nodes, links, tuning) {
  const sim = forceSimulation(nodes, 2)
    .force('link', forceLink(links).id((d) => d.id).distance(30))
    .force('charge', forceManyBody().strength(tuning.chargeStrength))
    .force('center', forceCenter(0, 0))
    .velocityDecay(tuning.velocityDecay)
    .alphaDecay(tuning.alphaDecay);
  for (let i = 0; i < tuning.warmupTicks && sim.alpha() > 0.02; i++) sim.tick();
  let ticks = 0;
  while (sim.alpha() > 0.005 && ticks < tuning.cooldownTicks) { sim.tick(); ticks++; }
  sim.stop();
  return { ticks };
}

/** 归一化：把布局缩放到画布尺度（模拟 normalizeAggregateLayout）+ 碰撞松弛 + 重新居中 */
function normalizeToCanvas(nodes, canvasW, canvasH) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
  }
  const spanX = Math.max(48, maxX - minX), spanY = Math.max(48, maxY - minY);
  const padding = Math.min(64, Math.max(28, canvasW * 0.1));
  const s = Math.min((canvasW - padding * 2) / spanX, (canvasH - padding * 2) / spanY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (const n of nodes) { n.x = (n.x - cx) * s; n.y = (n.y - cy) * s; }
  // 碰撞松弛（80 轮）——与页面一致
  const positioned = nodes.filter((n) => typeof n.x === 'number' && typeof n.y === 'number');
  for (let iter = 0; iter < 80; iter++) {
    let moved = 0;
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i], b = positioned[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy;
        const minDist = (renderRadius(a) + renderRadius(b)) * 1.08;
        if (dist2 < minDist * minDist && dist2 > 1e-6) {
          const dist = Math.sqrt(dist2);
          const overlap = (minDist - dist) / dist;
          a.x -= dx * overlap * 0.5; a.y -= dy * overlap * 0.5;
          b.x += dx * overlap * 0.5; b.y += dy * overlap * 0.5;
          moved += 1;
        }
      }
    }
    if (moved === 0) break;
  }
  let sumX = 0, sumY = 0;
  for (const n of positioned) { sumX += n.x; sumY += n.y; }
  const meanX = sumX / positioned.length, meanY = sumY / positioned.length;
  for (const n of positioned) { n.x -= meanX; n.y -= meanY; }
}

function measure(nodes, links, opts = {}) {
  const { canvasW = 448, canvasH = 687, mode = 'overview' } = opts;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
  }
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const k = 1.0; // 归一化后 zoomToFit 缩放 ≈ 1
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  const nodesS = nodes.map((n) => {
    const sx = (n.x - cx) * k + canvasW / 2;
    const sy = (n.y - cy) * k + canvasH / 2;
    const r = renderRadius(n);
    return { id: n.id, name: n.name, val: n.val, sx, sy, r: r * k, rGraph: r, isTopic: n.isTopic, isDimmed: n.isDimmed === true };
  });

  const overlaps = [];
  for (let i = 0; i < nodesS.length; i++) {
    for (let j = i + 1; j < nodesS.length; j++) {
      const a = nodesS[i], b = nodesS[j];
      const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      if (dist < 0.88 * (a.r + b.r)) overlaps.push({ a: a.name, b: b.name, dist: dist.toFixed(1), rSum: (a.r + b.r).toFixed(1), ra: a.r.toFixed(1), rb: b.r.toFixed(1) });
    }
  }

  const clipped = nodesS.filter((n) => n.sx - n.r < 8 || n.sx + n.r > canvasW - 8 || n.sy - n.r < 8 || n.sy + n.r > canvasH - 8);

  // 节点内文字可读性：名称字号 = min(r*0.62, 内宽/字数)，需 >= 5.5px 才绘制；徽标不参与布局
  let labelReadable = 0, labelTooSmall = 0;
  for (const n of nodesS) {
    if (!n.isTopic || n.isDimmed) continue;
    const innerWidth = n.rGraph * 1.55;
    const maxChars = Math.max(2, Math.floor(innerWidth / (n.rGraph * 0.62)));
    const labelLen = Math.min(Math.min(maxChars, 7), String(n.name).length);
    const nameFont = Math.min(n.rGraph * 0.62, innerWidth / Math.max(labelLen, 1));
    if (nameFont * k >= 5.5) labelReadable++; else labelTooSmall++;
  }
  // 徽标重叠检查：相邻节点的右上角徽标（0.72r + 6.5px）间距
  let badgeOverlaps = 0;
  for (let i = 0; i < nodesS.length; i++) {
    for (let j = i + 1; j < nodesS.length; j++) {
      const a = nodesS[i], b = nodesS[j];
      if (!a.isTopic || !b.isTopic || a.isDimmed || b.isDimmed) continue;
      const ax = a.sx + a.r * 0.72, ay = a.sy - a.r * 0.72;
      const bx = b.sx + b.r * 0.72, by = b.sy - b.r * 0.72;
      const dist = Math.hypot(ax - bx, ay - by);
      const rad = Math.max(4.2, Math.min(6.5, a.r * 0.3)) + Math.max(4.2, Math.min(6.5, b.r * 0.3));
      if (dist < rad) badgeOverlaps++;
    }
  }

  const radii = nodesS.map((n) => n.r).sort((a, b) => a - b);
  return {
    mode, nodeCount: nodes.length, linkCount: links.length,
    bbox: { w: Math.round(bw), h: Math.round(bh) },
    zoomK: k,
    screenRadius: { min: Math.round(radii[0] * 10) / 10, med: Math.round(radii[Math.floor(radii.length / 2)] * 10) / 10, max: Math.round(radii[radii.length - 1] * 10) / 10 },
    overlapCount: overlaps.length,
    overlapRate: Math.round((overlaps.length / Math.max(1, nodesS.length)) * 100) / 100,
    overlapSample: overlaps.slice(0, 5),
    clippedCount: clipped.length,
    labelReadable, labelTooSmall, badgeOverlaps,
  };
}

const args = process.argv.slice(2);
const wantDrill = args.includes('--drill');

const [nodes, links] = await Promise.all([
  fetchTable('knowledge_nodes', 'id,name,val,color,kind,aliases,source_captured_ids,metadata,created_at'),
  fetchTable('knowledge_links', 'id,source,target,relation_type,evidence_captured_ids,confidence,created_at'),
]);
const { topics, nodeToTopic } = buildHierarchicalGraph(
  nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
  links.map((l) => ({ source: l.source, target: l.target })),
);
console.error(`data: ${nodes.length} nodes, ${links.length} links`);

const nodeIdSet = new Set(nodes.map((n) => n.id));

// 色板区分度：读取真实 topic.color
const topicColors = topics.map((t) => t.color);
const colorDistances = [];
for (let i = 0; i < topicColors.length; i++) for (let j = i + 1; j < topicColors.length; j++) colorDistances.push(colorDist(topicColors[i], topicColors[j]));
colorDistances.sort((a, b) => a - b);
const dupColors = new Map();
for (const t of topics) {
  const arr = dupColors.get(t.color) || [];
  arr.push(t.name);
  dupColors.set(t.color, arr);
}

if (!wantDrill) {
  // 总览层
  const aggNodes = topics.map((t) => ({
    id: `topic:${t.communityId}`, name: t.name, val: t.communityId === -1 ? 8 : Math.max(10, Math.min(32, 10 + t.memberIds.length * 0.7)),
    isTopic: true, communityId: t.communityId, isDimmed: t.communityId === -1, memberCount: t.memberIds.length,
  }));
  const aggLinks = [];
  const keySet = new Set();
  for (const l of links) {
    if (!nodeIdSet.has(l.source) || !nodeIdSet.has(l.target)) continue; // 与页面 timeNodeIds 过滤一致（悬空边不渲染）
    const sc = nodeToTopic.get(l.source), tc = nodeToTopic.get(l.target);
    const sEnd = sc !== undefined ? `topic:${sc}` : l.source;
    const tEnd = tc !== undefined ? `topic:${tc}` : l.target;
    if (sEnd === tEnd) continue;
    const key = sEnd < tEnd ? `${sEnd}\u0000${tEnd}` : `${tEnd}\u0000${sEnd}`;
    if (keySet.has(key)) continue;
    keySet.add(key);
    aggLinks.push({ source: sEnd, target: tEnd });
  }
  const crossDegree = new Map();
  for (const l of aggLinks) {
    crossDegree.set(l.source, (crossDegree.get(l.source) || 0) + 1);
    crossDegree.set(l.target, (crossDegree.get(l.target) || 0) + 1);
  }
  for (const n of aggNodes) {
    if (n.isTopic) {
      const topic = topics.find((t) => t.communityId === n.communityId);
      const degree = crossDegree.get(n.id) || 0;
      // 与页面一致："其他知识"桶固定小尺寸
      n.val = n.communityId === -1 ? 8 : Math.max(12, Math.min(36, 10 + (topic?.memberIds.length || 0) * 0.5 + degree * 0.8));
    }
  }
  const tuning = forceTuning(aggNodes.length);
  const { ticks } = simulate(aggNodes, aggLinks, tuning);
  normalizeToCanvas(aggNodes, 448, 687);
  const m = measure(aggNodes, aggLinks, { mode: 'overview' });
  console.log(JSON.stringify({
    ...m, tuning, ticks,
    colorMin: Math.round(colorDistances[0]), colorMed: Math.round(colorDistances[Math.floor(colorDistances.length / 2)]),
    colorNearPairs: colorDistances.filter((d) => d < 60).length,
    dupColorGroups: [...dupColors.values()].filter((v) => v.length > 1).length,
    topTopics: topics.slice(0, 8).map((t) => ({ name: t.name, members: t.memberIds.length, hidden: t.hiddenCount })),
  }, null, 2));
} else {
  // 下钻层：成员最多的话题（跳过"其他知识"桶）
  const drill = topics.filter((t) => t.communityId !== -1).slice().sort((a, b) => b.memberIds.length - a.memberIds.length)[0];
  console.error(`drill topic: ${drill.name} (${drill.memberIds.length} members)`);
  const drillSet = new Set(drill.memberIds);
  const neighborTopicIds = new Set();
  for (const l of links) {
    if (!nodeIdSet.has(l.source) || !nodeIdSet.has(l.target)) continue;
    if (drillSet.has(l.source) && nodeToTopic.has(l.target) && nodeToTopic.get(l.target) !== drill.communityId) neighborTopicIds.add(nodeToTopic.get(l.target));
    if (drillSet.has(l.target) && nodeToTopic.has(l.source) && nodeToTopic.get(l.source) !== drill.communityId) neighborTopicIds.add(nodeToTopic.get(l.source));
  }
  const nodeName = new Map(nodes.map((n) => [n.id, n.name]));
  const dNodes = drill.memberIds.map((mid) => ({ id: mid, name: nodeName.get(mid) || mid, val: 8, isTopic: false }));
  for (const tid of neighborTopicIds) {
    const t = topics.find((x) => x.communityId === tid);
    if (!t) continue;
    dNodes.push({ id: `topic:${tid}`, name: t.name, val: Math.max(10, Math.min(28, 8 + t.memberIds.length * 0.6)), isTopic: true, communityId: tid, isDimmed: tid === -1, memberCount: t.memberIds.length });
  }
  const dLinks = [];
  const dKeySet = new Set();
  for (const l of links) {
    if (!nodeIdSet.has(l.source) || !nodeIdSet.has(l.target)) continue;
    const sIn = drillSet.has(l.source), tIn = drillSet.has(l.target);
    if (!sIn && !tIn) continue;
    const sc = nodeToTopic.get(l.source), tc = nodeToTopic.get(l.target);
    const sEnd = sIn ? l.source : `topic:${sc}`;
    const tEnd = tIn ? l.target : `topic:${tc}`;
    if (sEnd === tEnd) continue;
    const key = sEnd < tEnd ? `${sEnd}\u0000${tEnd}` : `${tEnd}\u0000${sEnd}`;
    if (dKeySet.has(key)) continue;
    dKeySet.add(key);
    dLinks.push({ source: sEnd, target: tEnd });
  }
  const tuning = forceTuning(dNodes.length);
  const { ticks } = simulate(dNodes, dLinks, tuning);
  normalizeToCanvas(dNodes, 448, 687);
  const m = measure(dNodes, dLinks, { mode: 'drill' });
  console.log(JSON.stringify({ ...m, tuning, ticks, drillName: drill.name, drillMembers: drill.memberIds.length, neighborTopics: neighborTopicIds.size }, null, 2));
}
