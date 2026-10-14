/**
 * scripts/backfill-demo-emb.mjs — 演示模式节点向量回填(2026-10-14)
 * 背景: demo 980 节点只剩 1 个有 embedding(历史回填丢失),语义搜索/推荐残废。
 * 做法: 从库拉缺失清单 → 本地 edgefn bge-m3(国内 IP 可用)批量向量化 → 分批 UPDATE。
 * 输出: backfill-emb-N.sql 分片,逐个 supabase db query --linked 执行。
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const SCOPE = '00000000-0000-0000-0000-000000000000';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const BASE = (env.MINIMAX_BASE_URL || 'https://api.edgefn.net/v1').replace(/\/$/, '');
const EMB_KEY = env.MINIMAX_API_KEY;

// 拉缺失节点(id, name)
const listSql = `select json_agg(row_to_json(t)) as j from (select id::text, name from knowledge_nodes where scope_id='${SCOPE}' and embedding is null order by created_at) t;`;
fs.writeFileSync('bf-list.sql', listSql);
if (!fs.existsSync('bf-raw.txt')) {
  fs.writeFileSync('bf-raw.txt', execSync(`npx -y supabase@2.121.0 db query --linked --file bf-list.sql`, { encoding: 'utf8', maxBuffer: 1 << 26 }));
}
const raw = fs.readFileSync('bf-raw.txt', 'utf8');
const rows = (() => {
  const m = raw.match(/"j":\s*(\[.*?\])\s*\}/s) || raw.match(/(\[\{.*?\}\])/s);
  return m ? JSON.parse(m[1]).map(r => [r.id, r.name]) : [];
})();
console.log('缺失向量节点:', rows.length);
if (!rows.length) process.exit(0);

const embLit = v => `[${v.map(x => x.toFixed(7)).join(',')}]`;
let file = 0, done = 0;
for (let i = 0; i < rows.length; i += 50) {
  const shard = `backfill-emb-${file + 1}.sql`;
  if (fs.existsSync(shard)) { file++; done += 50; continue; } // 断点续跑
  const chunk = rows.slice(i, i + 50);
  let j = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    const r = await fetch(`${BASE}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EMB_KEY}` },
      body: JSON.stringify({ model: 'BAAI/bge-m3', input: chunk.map(([, name]) => `${name}。`) }),
    });
    if (r.status === 429) {
      console.log(`  批 ${file + 1} 限流,等 20s 重试(${attempt}/10)`);
      await new Promise(res => setTimeout(res, 20000));
      continue;
    }
    if (!r.ok) throw new Error(`embed ${r.status}: ${(await r.text()).slice(0, 200)}`);
    j = await r.json();
    break;
  }
  if (!j) throw new Error(`批 ${file + 1} 重试耗尽`);
  const sets = chunk.map(([id], k) => `('${id}'::uuid, '${embLit(j.data[k].embedding)}'::vector)`).join(',\n');
  fs.writeFileSync(shard,
    `update knowledge_nodes n set embedding = v.emb, updated_at = now()\nfrom (values ${sets}) as v(id, emb)\nwhere n.id = v.id;\n`);
  file++; done += chunk.length;
  console.log(`  批 ${file}: ${done}/${rows.length}`);
}
console.log(`生成 ${file} 个分片 SQL`);
