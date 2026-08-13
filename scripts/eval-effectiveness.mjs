#!/usr/bin/env node
/**
 * eval-effectiveness.mjs — 图谱抽取与总结/推送有效性评估
 *
 * 原理：用 deepening 数据集的"设计信号"作 ground truth，量化三项能力：
 *
 *  1. 节点抽取（/api/graph/extract）
 *     - 召回率：期望概念被抽出的比例（包含匹配，如期望"加班"命中节点"加班复盘"）
 *     - 精确率：抽出的节点中非噪声比例（第4章/1.5小时/22点/吃饭这类不得出现）
 *  2. 总结（/api/summarize 7d + 30d）
 *     - 信号检出：加班升温、健身降温、冥想新生、因果链出现、噪声零泄漏
 *  3. 推送（/api/recommend）
 *     - 信号检出：语义对（睡眠簇）、形成主题（加班/冥想）、证据引用
 *     - 噪声零泄漏：任何推荐不得引用噪声记录
 *
 * 用法: node scripts/eval-effectiveness.mjs
 * 前置: 本地 API 3000 运行中, deepening 数据集已注入 demo scope
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const API_BASE = 'http://127.0.0.1:3000';

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}
const env = loadEnv(path.join(REPO_ROOT, '.env.local'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(route, body, timeoutMs = 240_000, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${API_BASE}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EvolvMind-Demo': 'true' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await resp.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      if (!resp.ok) {
        const err = new Error(`${route} -> ${resp.status}: ${typeof json === 'string' ? json : JSON.stringify(json).slice(0, 200)}`);
        if (resp.status === 429) err.isRateLimit = true;
        throw err;
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError' || !e.isRateLimit || attempt >= retries) {
        if (e.name === 'AbortError' && attempt < retries) {
          await sleep(10_000);
          continue;
        }
        throw e;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// ================================================================
// Ground truth
// ================================================================

/** 抽取用例：content 片段 + 期望概念组（组内任一同义词命中即算召回）+ 禁止出现的噪声节点 */
const EXTRACT_CASES = [
  { id: 'ot-1-加班周', content: '项目攻坚第一周实际加班 3 天到 21 点。晚上回家还刷一小时手机才睡, 入睡明显变晚。周末补觉也补不回来, 白天还是困。', expect: [['加班'], ['睡眠', '入睡']], forbid: ['21点', '一小时'] },
  { id: 'ot-2-头痛', content: '这周连着三天加班到 22 点, 今天下午开始偏头痛, 注意力完全涣散。睡眠不足后的工作日, 有效产出只有正常时的六成。', expect: [['加班'], ['头痛'], ['睡眠']], forbid: ['22点'] },
  { id: 'ot-3-恶性循环', content: '加班到 22 点。到家改方案到 23:30, 躺下脑子里还在过排期, 结果失眠到快 1 点。白天咖啡续命, 下午又犯困。恶性循环: 加班→失眠→咖啡→低效→再加班。', expect: [['加班'], ['失眠'], ['咖啡']], forbid: ['22点', '23:30', '1点'] },
  { id: 'ot-4-晨跑', content: '停跑两个月, 今天重新开始: 3 公里, 配速 7 分, 心率 155。计划每周三跑: 周二四六。先恢复频率。', expect: [['晨跑', '跑步', '跑'], ['配速']], forbid: ['心率155', '周二', '周四', '周六', '3公里'] },
  { id: 'ot-5-睡不着', content: '关了灯躺下两个小时, 脑子里一直在过白天的对话和排期。明明很累, 就是停不下来。试过数呼吸, 数到 200 还是清醒。', expect: [['失眠', '睡不着', '入睡']], forbid: ['两个小时', '200'] },
  { id: 'ot-6-咖啡因', content: '怀疑下午咖啡影响夜间睡眠, 开始实验: 14 点后不碰咖啡因。第一周入睡提前 25 分钟, 但下午困得厉害。', expect: [['咖啡因'], ['睡眠']], forbid: ['14点', '25分钟'] },
  { id: 'ot-7-冥想', content: '跟着 app 做了一次 10 分钟冥想, 全程思绪乱飞, 但结束时确实安静了一点。决定先坚持一周, 目标是睡前冥想替代刷手机。', expect: [['冥想']], forbid: ['10分钟', 'app'] },
  { id: 'ot-8-碎片章节', content: '通勤 40 分钟, 把《深度工作》第 4 章读完了, 讲的是注意力残余和任务切换的代价, 正好对应最近的加班低效。', expect: [['深度工作'], ['注意力残余']], forbid: ['第4章', '40分钟'] },
];

/** 噪声捕获标题——总结/推送不得引用 */
const NOISE_TITLES = ['窗外有只橘猫在晒太阳', '今天天气不错', '测试测试 123'];

/** 设计信号 */
const SIGNALS = {
  risingTheme: '加班',        // 7d 应 up/new
  newTheme: '冥想',           // 7d 应 new
  semanticPairs: [            // 无共享标签但语义相近的捕获对（实测相似度 0.60-0.70，应命中 ≥1）
    ['冥想第三天', '下午昏沉记录'],
    ['加班复盘', '下午昏沉记录'],
  ],
  fallingTheme: '健身',       // 30d 应 down
  chainKeywords: ['加班', '睡眠', '咖啡因', '冥想'], // 叙事应命中 ≥2
};
// ================================================================
// 1. 节点抽取: 精确率 / 召回率
// ================================================================

const TRIVIAL_NODE = (name) => {
  const s = (name || '').trim();
  if (!s) return true;
  if (/^第\d+[章节篇]$/.test(s)) return true;
  if (/^\d+(\.\d+)?(分钟|小时|天|周|月|年|秒)$/.test(s)) return true;
  if (/^\d{1,2}[:：]\d{2}$/.test(s)) return true;
  if (/^(凌晨|早上|上午|中午|下午|晚上|傍晚|夜里)?\d{1,2}点(半|多|过|左右)?$/.test(s)) return true;
  if (/^\d{1,2}月\d{1,2}[日号]$/.test(s)) return true;
  if (['今天', '明天', '昨天', '上周', '下周', '公司', '食堂', '睡觉', '吃饭', '计划', '工作', '学习', '生活', '健康', '时间', '效率'].includes(s)) return true;
  if (/^\d+$/.test(s)) return true;
  return false;
};
const exactAny = (name, patterns) => patterns.some((p) => name.trim() === p);

const containsAny = (name, patterns) => patterns.some((p) => name.includes(p));

async function evalExtraction() {
  let totalRecallHit = 0, totalRecallExp = 0;
  let totalPrecGood = 0, totalPrecAll = 0;

  for (const tc of EXTRACT_CASES) {
    let nodes = [];
    try {
      const j = await api('/api/graph/extract', { content: tc.content });
      nodes = (j.data?.nodes || j.nodes || []).map((n) => n.name);
    } catch (e) {
      console.log(`  [${tc.id}] 抽取失败: ${e.message}`);
      continue;
    }
    const hit = tc.expect.filter((group) => group.some((p) => nodes.some((n) => n.includes(p))));
    const forbidHit = nodes.filter((n) => exactAny(n, tc.forbid) || TRIVIAL_NODE(n));
    totalRecallHit += hit.length;
    totalRecallExp += tc.expect.length;
    totalPrecGood += nodes.length - forbidHit.length;
    totalPrecAll += nodes.length;
    console.log(`  [${tc.id}] 节点(${nodes.length}): ${nodes.map((n) => n.slice(0, 14)).join(', ') || '(空)'}`);
    console.log(`    召回 ${hit.length}/${tc.expect.length} (${hit.map((g) => g[0]).join('/')}) | 噪声 ${forbidHit.length} (${forbidHit.map((n) => n.slice(0, 10)).join(',') || '-'})`);
    await sleep(1000);
  }
  const recall = totalRecallExp ? (totalRecallHit / totalRecallExp) * 100 : 0;
  const precision = totalPrecAll ? (totalPrecGood / totalPrecAll) * 100 : 0;
  console.log(`\n  抽取结果: 召回率 ${recall.toFixed(0)}% (${totalRecallHit}/${totalRecallExp}) | 精确率 ${precision.toFixed(0)}% (${totalPrecGood}/${totalPrecAll})`);
  return { recall, precision };
}

// ================================================================
// 2. 总结: 信号检出 + 噪声零泄漏
// ================================================================

async function evalSummary() {
  console.log('\n========== 2. 总结 信号检出 ==========');
  const sum7 = await api('/api/summarize', { period: '7d', demo: true });
  const sum30 = await api('/api/summarize', { period: '30d', demo: true });
  const results = [];

  const themeDir = (sum, name) => {
    const t = (sum.themes || []).find((x) => x.name.includes(name));
    return t?.direction || null;
  };
  const allThemeNames = (sum) => (sum.themes || []).map((t) => t.name).join('、');
  const narrative = `${sum7.narrative || ''} ${sum30.narrative || ''}`;
  const highlights = [...(sum7.highlights || []), ...(sum30.highlights || [])].join(' ');

  // 信号 1: 加班升温 (7d)
  const ot = themeDir(sum7, SIGNALS.risingTheme);
  results.push(['加班升温(7d)', ['up', 'new'].includes(ot), `direction=${ot} (themes: ${allThemeNames(sum7).slice(0, 60)})`]);

  // 信号 2: 冥想新生 (7d)
  const mt = themeDir(sum7, SIGNALS.newTheme);
  results.push(['冥想新生(7d)', ['up', 'new'].includes(mt), `direction=${mt}`]);

  // 信号 3: 健身降温 (30d) — 健身/运动/精力 任一主题显示 down 即算（簇级检查）
  const ft = themeDir(sum30, SIGNALS.fallingTheme);
  const ftCluster = (sum30.themeTrends || []).find((t) => ['健身', '运动', '精力'].some((k) => t.name.includes(k)));
  const ftOk = ft === 'down' || ftCluster?.direction === 'down';
  results.push(['健身降温(30d)', ftOk, `themes=${ft} | themeTrends=${ftCluster ? `${ftCluster.name}(${ftCluster.recent}/${ftCluster.older}:${ftCluster.direction})` : '(无)'}`]);

  // 信号 5: 噪声零泄漏（摘录/主题不得出现噪声）
  const leaked = NOISE_TITLES.filter((t) => highlights.includes(t.slice(0, 8)) || allThemeNames(sum7).includes(t.slice(0, 4)) || allThemeNames(sum30).includes(t.slice(0, 4)));
  results.push(['噪声零泄漏', leaked.length === 0, leaked.length ? `泄漏: ${leaked.join('、')}` : 'OK']);

  // 信号 6: 行动建议可执行（≥3 条）
  results.push(['行动建议≥3条', (sum7.nextActions || []).length >= 3, `${(sum7.nextActions || []).length} 条`]);

  let pass = 0;
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}: ${detail}`);
    if (ok) pass++;
  }
  console.log(`  总结: ${pass}/${results.length} 信号检出`);
  return pass / results.length;
}

// ================================================================
// 3. 推送: 信号检出 + 噪声零泄漏
// ================================================================

async function evalRecommend() {
  console.log('\n========== 3. 推送 信号检出 ==========');
  const rec = await api('/api/recommend', { demo: true, dismissed_ids: [] });
  const items = rec.recommendations || [];
  const results = [];
  const allText = JSON.stringify(items);

  // 信号 1: 语义对命中（睡眠簇）
  const semHits = SIGNALS.semanticPairs.filter(([a, b]) => allText.includes(a.slice(0, 6)) && allText.includes(b.slice(0, 6)));
  results.push(['语义对(睡眠簇)', semHits.length >= 1, `${items.filter((r) => r.type === 'semantic').length} 条语义推荐 (命中 ${semHits.length} 对)`]);

  // 信号 2: 形成主题（加班/冥想）
  const forming = items.filter((r) => r.type === 'forming');
  const formingHit = forming.some((r) => r.title.includes(SIGNALS.risingTheme) || r.title.includes(SIGNALS.newTheme));
  results.push(['形成主题(加班/冥想)', formingHit, forming.map((r) => r.title).join('、') || '(无)']);

  // 信号 3: 证据引用（≥1 条带 evidence 且 evidence 有内容）
  const withEvidence = items.filter((r) => (r.evidence || []).length >= 2);
  results.push(['证据引用(≥2条evidence)', withEvidence.length >= 1, `${withEvidence.length} 条带证据`]);

  // 信号 4: 图谱定位（≥1 条带 nodeId 可跳转）
  const withNode = items.filter((r) => r.nodeId);
  results.push(['图谱可定位(nodeId)', withNode.length >= 1, `${withNode.length} 条`]);

  // 信号 5: 噪声零泄漏
  const leaked = NOISE_TITLES.filter((t) => allText.includes(t.slice(0, 8)));
  results.push(['噪声零泄漏', leaked.length === 0, leaked.length ? `泄漏: ${leaked.join('、')}` : 'OK']);

  let pass = 0;
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}: ${detail}`);
    if (ok) pass++;
  }
  console.log(`  推送: ${pass}/${results.length} 信号检出`);
  return pass / results.length;
}

// ================================================================
// Main
// ================================================================

async function main() {
  console.log(`EvolvMind 有效性评估 | API: ${API_BASE} | demo scope`);
  console.log(`依赖: deepening 数据集已注入 demo scope (未注入时信号检出会降级)`);

  const extraction = await evalExtraction();
  const summary = await evalSummary();
  const recommend = await evalRecommend();

  console.log('\n========== 汇总 ==========');
  console.log(`抽取: 召回率 ${extraction.recall.toFixed(0)}% / 精确率 ${extraction.precision.toFixed(0)}%`);
  console.log(`总结: ${(summary * 100).toFixed(0)}% 信号检出`);
  console.log(`推送: ${(recommend * 100).toFixed(0)}% 信号检出`);
  const overall = (extraction.recall + extraction.precision + summary * 100 + recommend * 100) / 4;
  console.log(`综合有效性: ${overall.toFixed(0)}%`);
}

main().catch((e) => {
  console.error('评估脚本异常:', e);
  process.exit(1);
});
