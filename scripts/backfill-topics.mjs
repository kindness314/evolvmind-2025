/**
 * scripts/backfill-topics.mjs — 一次性回填 demo 全部节点语义主题到 topic_labels
 * 运行: bun scripts/backfill-topics.mjs
 * 分批（≤200/批）调本地 topicize；topicize 内部命中缓存表即秒回，未命中走 LLM 并写库。
 * 预计 demo 全量 ~12 分钟。可重复跑（幂等，命中缓存不再生成）。
 */
const BASE = 'http://127.0.0.1:3000/api/graph/topicize';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvY2Nod3J2bGhxZHd0dmZ3ZmFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODQ1ODIsImV4cCI6MjA5MTA2MDU4Mn0.BVlVGSpKth0t6kFSAoZSU0N_DzAYpWGAMIn4RhxRswk';
const REST = 'https://wocchwrvlhqdwtvfwfab.supabase.co/rest/v1/';

async function fetchAllNodes() {
  const out = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const res = await fetch(`${REST}knowledge_nodes?select=id,name,aliases`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + PAGE - 1}` },
    });
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const nodes = await fetchAllNodes();
console.log(`nodes: ${nodes.length}`);
let classifiedTotal = 0;
const BATCH = 60;
for (let i = 0; i < nodes.length; i += BATCH) {
  const batch = nodes.slice(i, i + BATCH).map((n) => ({ id: n.id, name: n.name, aliases: n.aliases || [] }));
  let classified = 0;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const t0 = Date.now();
    const resp = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EvolvMind-Demo': 'true' },
      body: JSON.stringify({ nodes: batch, demo: true }),
    });
    const data = await resp.json().catch(() => null);
    classified = data?.classified || 0;
    if (resp.ok && (classified > 0 || data?.generated === 0)) {
      classifiedTotal += classified;
      console.log(`batch ${i}-${i + batch.length}: classified=${classified}, generated=${data.generated ?? '?'} in ${((Date.now() - t0) / 1000).toFixed(1)}s (attempt ${attempts})`);
      break;
    }
    if (attempts >= 4) {
      console.log(`batch ${i}: giving up after ${attempts} (classified=${classified})`);
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
console.log(`done. total classified cached: ${classifiedTotal}/${nodes.length}`);
