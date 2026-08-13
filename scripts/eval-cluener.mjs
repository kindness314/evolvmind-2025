#!/usr/bin/env node
/**
 * eval-cluener.mjs — L1: 用权威外部数据集 CLUENER2020 验证实体抽取切片
 *
 * 目的：用清华/CLUE 的中文细粒度 NER 基准（Sina 新闻，10 类实体）给
 * /api/graph/extract 的实体抽取能力做外部验证，测量：
 *   - 召回率：CLUENER 标注的实体有多少被我们的抽取捕获（包含匹配）
 *   - 精确率/幻觉率：我们抽出的 person/location 节点里，多少是对应文本中的真实实体
 *   - 对照组：无实体句子上的误报率
 *
 * 诚实边界（评估本身只如实报告）：
 *   - CLUENER 是新闻文体，不是个人笔记；测的是实体切片鲁棒性，不是笔记域抽取
 *   - 我们的 prompt 有意抑制泛称组织/公司（"不要公司食堂"），所以 organization 召回
 *     会系统性偏低——这是任务设计差异，不是缺陷
 *   - 中文包含匹配：实体"北京市朝阳区"与节点"北京"互相包含即算命中
 *
 * 数据：首次运行自动下载 cluener_public.zip 到 scripts/eval-data/
 *   https://storage.googleapis.com/cluebenchmark/tasks/cluener_public.zip
 *
 * 用法: node scripts/eval-cluener.mjs
 * 前置: 本地 API 3000 运行中
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'eval-data');
const ZIP = path.join(DATA_DIR, 'cluener_public.zip');
const DEV_JSON = path.join(DATA_DIR, 'dev.json');
const API_BASE = 'http://127.0.0.1:3000';
const URL_ZIP = 'https://storage.googleapis.com/cluebenchmark/tasks/cluener_public.zip';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureData() {
  if (fs.existsSync(DEV_JSON)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('下载 CLUENER2020 数据...');
  const r = await fetch(URL_ZIP, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`);
  fs.writeFileSync(ZIP, Buffer.from(await r.arrayBuffer()));
  // 解压（Node 无内置 zip 解压，用 PowerShell on Windows / unzip 兜底）
  const { execSync } = await import('node:child_process');
  try {
    execSync(`powershell -Command "Expand-Archive -Path '${ZIP}' -DestinationPath '${DATA_DIR}' -Force"`, { stdio: 'inherit' });
  } catch {
    execSync(`unzip -o "${ZIP}" -d "${DATA_DIR}"`, { stdio: 'inherit' });
  }
}

async function extract(content, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${API_BASE}/api/graph/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EvolvMind-Demo': 'true' },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(120_000),
      });
      const j = await resp.json();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(j).slice(0, 120)}`);
      return j.data || j;
    } catch (e) {
      lastErr = e;
      if (/429/.test(e.message) && attempt < retries) {
        await sleep(20_000);
        continue;
      }
      if (e.name === 'TimeoutError' && attempt < retries) {
        await sleep(10_000);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

// 中文包含匹配：a 包含 b 或 b 包含 a，且较长者 ≥2 字
function overlaps(a, b) {
  const [x, y] = a.length >= b.length ? [a, b] : [b, a];
  return x.length >= 2 && y.length >= 2 && x.includes(y);
}

async function main() {
  await ensureData();
  const dev = fs.readFileSync(DEV_JSON, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

  // 收集每条的参考实体（实体名 + 类别）
  const rows = dev.map((e) => {
    const refs = [];
    for (const [cat, ents] of Object.entries(e.label || {})) {
      for (const [name] of Object.entries(ents)) refs.push({ cat, name });
    }
    return { text: e.text, refs };
  });

  // 采样：目标类别（name/location 相关）优先 + 无实体对照
  const targetCats = ['name', 'address', 'scene', 'organization', 'government', 'position'];
  const picked = [];
  const used = new Set();
  const take = (pred) => {
    for (let i = 0; i < rows.length && picked.length < 30; i++) {
      if (used.has(i)) continue;
      const r = rows[i];
      if (r.text.length > 110) continue;
      if (pred(r)) { picked.push({ ...r, i }); used.add(i); }
    }
  };
  for (const cat of targetCats) take((r) => r.refs.some((x) => x.cat === cat));
  take((r) => r.refs.length === 0); // 无实体对照

  console.log(`\nCLUENER L1 实体切片评估 — ${picked.length} 条 (目标类别: ${targetCats.join('/')} + 无实体对照)\n`);
  console.log('='.repeat(80));

  let refTotal = 0, refHit = 0;
  let entityNodesTotal = 0, entityNodesMatched = 0;
  let falsePositiveTotal = 0, falsePositiveCases = 0;

  for (let k = 0; k < picked.length; k++) {
    const { text, refs } = picked[k];
    let graph;
    try {
      graph = await extract(text);
    } catch (e) {
      console.log(`  [${k + 1}] 抽取失败: ${e.message}`);
      continue;
    }
    const nodes = (graph.nodes || []).map((n) => ({ name: n.name, kind: n.kind }));
    // 候选实体节点：person/location 及名字包含参考实体的任何节点
    const refNames = refs.map((r) => r.name);
    const matchedRefs = refs.filter((r) => nodes.some((n) => overlaps(n.name, r.name)));
    const entityKindNodes = nodes.filter((n) => ['person', 'location'].includes(n.kind));
    const matchedNodes = entityKindNodes.filter((n) => refNames.some((rn) => overlaps(n.name, rn)));
    const fpNodes = entityKindNodes.filter((n) => !refNames.some((rn) => overlaps(n.name, rn)));

    refTotal += refs.length;
    refHit += matchedRefs.length;
    entityNodesTotal += entityKindNodes.length;
    entityNodesMatched += matchedNodes.length;
    if (fpNodes.length > 0) { falsePositiveTotal += fpNodes.length; falsePositiveCases++; }

    const cats = [...new Set(refs.map((r) => r.cat))].join('/');
    console.log(`[${k + 1}/${picked.length}] ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`);
    console.log(`    参考实体(${refs.length}): ${refNames.slice(0, 5).join('、')}${refs.length > 5 ? '…' : ''} [${cats}]`);
    console.log(`    抽取 person/location: ${entityKindNodes.map((n) => n.name).join('、') || '(无)'}`);
    if (matchedRefs.length < refs.length) {
      const miss = refs.filter((r) => !matchedRefs.includes(r)).map((r) => `${r.name}(${r.cat})`);
      console.log(`    未命中: ${miss.slice(0, 4).join('、')}`);
    }
    if (fpNodes.length) console.log(`    可疑幻觉: ${fpNodes.map((n) => n.name).join('、')}`);
    await sleep(1200);
  }

  console.log('\n' + '='.repeat(80));
  const recall = refTotal ? (refHit / refTotal) * 100 : 0;
  const precision = entityNodesTotal ? (entityNodesMatched / entityNodesTotal) * 100 : 0;
  console.log(`\n实体召回率: ${recall.toFixed(0)}% (${refHit}/${refTotal})`);
  console.log(`实体精确率(person/location): ${precision.toFixed(0)}% (${entityNodesMatched}/${entityNodesTotal})`);
  console.log(`可疑幻觉节点: ${falsePositiveTotal} 个 (出现在 ${falsePositiveCases}/${picked.length} 条)`);
  console.log(`\n注: organization/government 召回偏低是任务设计差异（prompt 有意抑制泛称组织），`);
  console.log(`    精确率是本次评估的主要可信指标（幻觉率 = 100% - 精确率）。`);
}

main().catch((e) => {
  console.error('评估异常:', e);
  process.exit(1);
});
