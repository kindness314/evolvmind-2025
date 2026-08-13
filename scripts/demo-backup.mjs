#!/usr/bin/env node
/**
 * demo-backup.mjs — Demo scope 数据精确备份/恢复（保证可恢复的纯净测试前提）
 *
 * 用法:
 *   node scripts/demo-backup.mjs backup    # 全量导出 captured_info/knowledge_nodes/knowledge_links
 *   node scripts/demo-backup.mjs verify    # 校验备份文件与线上数量一致
 *   node scripts/demo-backup.mjs wipe      # 清空 demo scope 三张表（危险，先 backup+verify）
 *   node scripts/demo-backup.mjs restore   # 从最新备份按原主键回插并校验
 *
 * 恢复是"精确"的：保留原始 id/created_at/embedding，不是重跑种子的近似版本。
 * 数据目录: scripts/eval-data/backups/demo-<时间戳>/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEMO_SCOPE = '00000000-0000-0000-0000-000000000000';
const BACKUP_ROOT = path.join(__dirname, 'eval-data', 'backups');

// 读取 .env.local（兼容 CRLF）
const env = {};
for (const line of fs.readFileSync(path.join(REPO_ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const PROJECT_ID = env.VITE_SUPABASE_PROJECT_ID || '';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';
if (!PROJECT_ID || !ANON_KEY) { console.error('缺少 VITE_SUPABASE_* 环境变量'); process.exit(1); }
const REST = `https://${PROJECT_ID}.supabase.co/rest/v1`;
const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rest(pathStr, { method = 'GET', body } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(`${REST}${pathStr}`, {
        method,
        headers: { ...HEADERS, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(300_000),
      });
      const text = await resp.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      if (!resp.ok) throw new Error(`${method} ${pathStr} -> ${resp.status}: ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
      return json;
    } catch (e) {
      lastErr = e;
      // 网络错误（非 HTTP 状态）才重试
      if (!/^[A-Z]+ \/\S+ -> \d+/.test(e.message)) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** 分页拉全表（REST limit 上限 1000；节点表含 1024 维 embedding，用小块分页防超时） */
async function fetchAll(table, filter, chunkSize = 1000) {
  const rows = [];
  let offset = 0;
  while (true) {
    const batch = await rest(`/${table}?select=*&${filter}&limit=${chunkSize}&offset=${offset}`);
    rows.push(...(batch || []));
    if (!batch || batch.length < chunkSize) break;
    offset += chunkSize;
  }
  return rows;
}

const TABLES = [
  { name: 'captured_info', filter: 'user_id=is.null', chunk: 500 },
  { name: 'knowledge_nodes', filter: `scope_id=eq.${DEMO_SCOPE}`, chunk: 200 },
  { name: 'knowledge_links', filter: `scope_id=eq.${DEMO_SCOPE}`, chunk: 1000 },
];

async function cmdBackup() {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = path.join(BACKUP_ROOT, `demo-${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { ts, demoScope: DEMO_SCOPE, counts: {} };
  for (const t of TABLES) {
    const rows = await fetchAll(t.name, t.filter, t.chunk);
    manifest.counts[t.name] = rows.length;
    fs.writeFileSync(path.join(dir, `${t.name}.json`), JSON.stringify(rows));
    console.log(`  ${t.name}: ${rows.length} 行 -> ${t.name}.json`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`备份完成: ${dir}`);
}

function latestBackupDir() {
  if (!fs.existsSync(BACKUP_ROOT)) return null;
  const dirs = fs.readdirSync(BACKUP_ROOT).filter((d) => d.startsWith('demo-')).sort();
  return dirs.length ? path.join(BACKUP_ROOT, dirs[dirs.length - 1]) : null;
}

async function cmdVerify() {
  const dir = latestBackupDir();
  if (!dir) { console.error('没有可用备份'); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  console.log(`校验备份: ${dir}`);
  let ok = true;
  for (const t of TABLES) {
    const fileRows = JSON.parse(fs.readFileSync(path.join(dir, `${t.name}.json`), 'utf8'));
    const live = await fetchAll(t.name, t.filter, t.chunk);
    const match = fileRows.length === live.length;
    ok = ok && match;
    console.log(`  ${t.name}: 备份 ${fileRows.length} vs 线上 ${live.length} ${match ? '✅' : '❌'}`);
  }
  console.log(ok ? '备份校验通过' : '备份校验失败！');
  process.exit(ok ? 0 : 1);
}

async function cmdWipe() {
  for (const t of TABLES) {
    const res = await rest(`/${t.name}?${t.filter}`, { method: 'DELETE' });
    console.log(`  已清空 ${t.name}: ${res?.count ?? '?'} 行`);
    await sleep(500);
  }
  console.log('Demo scope 三表已清空');
}

async function cmdRestore() {
  const dir = latestBackupDir();
  if (!dir) { console.error('没有可用备份'); process.exit(1); }
  console.log(`从 ${dir} 恢复...`);
  // 先恢复 captured_info（节点/链接引用其 id）
  const order = ['captured_info', 'knowledge_nodes', 'knowledge_links'];
  for (const table of order) {
    // 幂等：恢复前先清空该表当前行（避免重复插入冲突）
    const t = TABLES.find((x) => x.name === table);
    const res = await rest(`/${table}?${t.filter}`, { method: 'DELETE' });
    console.log(`  清空 ${table} 当前行: ${res?.count ?? '?'}`);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, `${table}.json`), 'utf8'));
    // 预剥已知生成列（scope_id 由 user_id 生成，不能显式插入）
    if (table !== 'captured_info') {
      for (const row of rows) delete row.scope_id;
    }
    const CHUNK = table === 'knowledge_nodes' ? 30 : 100;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      let done = false;
      let attempt = 0;
      while (!done && attempt < 3) {
        try {
          await rest(`/${table}`, { method: 'POST', body: chunk });
          done = true;
        } catch (e) {
          const m = e.message.match(/column "([a-z_]+)"(?: of relation| is)/i);
          if (m) {
            for (const row of chunk) delete row[m[1]];
            console.warn(`  列 ${m[1]} 为生成列/触发器列，跳过`);
          } else throw e;
        }
      }
      inserted += chunk.length;
      if (i % 500 === 0 && i > 0) console.log(`  ${table}: ${inserted}/${rows.length}`);
    }
    console.log(`  ${table}: ${inserted}/${rows.length} 行已恢复`);
    await sleep(500);
  }
  // 校验
  await cmdVerify();
}

const mode = process.argv[2];
const modes = { backup: cmdBackup, verify: cmdVerify, wipe: cmdWipe, restore: cmdRestore };
if (!modes[mode]) {
  console.error(`用法: node scripts/demo-backup.mjs backup|verify|wipe|restore`);
  process.exit(1);
}
modes[mode]().catch((e) => { console.error('失败:', e.message); process.exit(1); });
