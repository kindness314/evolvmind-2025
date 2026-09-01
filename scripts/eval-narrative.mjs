#!/usr/bin/env node
/**
 * eval-narrative.mjs — L3: 叙事质量量化（LLM-as-judge）
 *
 * 对 summarize 的 7d/30d 输出逐维打分（忠实度/洞察/可执行/结构）+ 幻觉清单，
 * 把之前"只查关键词"的叙事检查升级为质量检查。
 * 裁判输入包含系统统计数据（stats/trends/themeTrends），避免把确定性数字误判为幻觉。
 *
 * 用法: node scripts/eval-narrative.mjs
 * 前置: 本地 API 3000 运行中; /api/judge 依赖远程 MINIMAX key（vercel dev 注入）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const API_BASE = 'http://127.0.0.1:3000';

const env = {};
for (const line of fs.readFileSync(path.join(REPO_ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

async function api(route, body, timeoutMs = 240_000) {
  const resp = await fetch(`${API_BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EvolvMind-Demo': 'true' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`${route} -> ${resp.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

async function fetchCaptures() {
  const url = `https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co/rest/v1`;
  const headers = { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` };
  const resp = await fetch(`${url}/captured_info?select=title,summary,content&user_id=is.null&order=created_at.desc&limit=100`, { headers, signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`captured fetch -> ${resp.status}`);
  return resp.json();
}

async function judgeOne(period, summary, captures) {
  const j = await api('/api/judge', {
    demo: true,
    narrative: summary.narrative || '',
    themes: summary.themes || [],
    nextActions: summary.nextActions || [],
    stats: summary.stats,
    trends: summary.trends,
    themeTrends: summary.themeTrends,
    weeklyTimeline: summary.weeklyTimeline || null,
    captures,
  });
  const scores = j.scores || {};
  console.log(`\n[${period}] 评分: 忠实度 ${scores.faithfulness ?? '-'} | 洞察 ${scores.insight ?? '-'} | 可执行 ${scores.actionability ?? '-'} | 结构 ${scores.structure ?? '-'}`);
  console.log(`  总评: ${j.overall || '-'}`);
  const hals = j.hallucinations || [];
  if (hals.length) {
    console.log(`  ⚠️ 幻觉发现 (${hals.length}):`);
    for (const h of hals) console.log(`    - ${h}`);
  } else {
    console.log(`  ✅ 无幻觉发现`);
  }
  return { period, scores, hallucinations: hals, overall: j.overall };
}

async function main() {
  console.log('L3 叙事质量评估（LLM-as-judge，四维评分 + 幻觉检查）\n');
  const captures = await fetchCaptures();
  console.log(`原始捕获依据: ${captures.length} 条（最近 100 条）`);

  const results = [];
  for (const period of ['7d', '30d']) {
    const summary = await api('/api/summarize', { period, demo: true });
    console.log(`\n===== ${period} 总结（叙事 ${summary.narrative?.length ?? 0} 字, ${(summary.themes || []).length} 主题, ${(summary.nextActions || []).length} 行动）=====`);
    console.log(`叙事: ${(summary.narrative || '').slice(0, 180)}…`);
    const r = await judgeOne(period, summary, captures);
    results.push(r);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('\n========== 汇总 ==========');
  for (const r of results) {
    const vals = Object.values(r.scores).filter((v) => typeof v === 'number');
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    console.log(`${r.period}: 均分 ${avg.toFixed(1)} | 幻觉 ${r.hallucinations.length} 条`);
  }
  const all = results.flatMap((r) => Object.values(r.scores)).filter((v) => typeof v === 'number');
  const allAvg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  console.log(`整体平均: ${allAvg.toFixed(1)}/10`);
  console.log(`\n注: LLM 评审 LLM 存在同源偏差，幻觉清单请人工抽查核对原始捕获。`);
}

main().catch((e) => { console.error('评估异常:', e.message); process.exit(1); });
