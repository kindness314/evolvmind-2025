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
const DATASET_EXTRACT = {
  deepening: [
    { id: 'ot-1-加班周', content: '项目攻坚第一周实际加班 3 天到 21 点。晚上回家还刷一小时手机才睡, 入睡明显变晚。周末补觉也补不回来, 白天还是困。', expect: [['加班'], ['睡眠', '入睡']], forbid: ['21点', '一小时'] },
    { id: 'ot-2-头痛', content: '这周连着三天加班到 22 点, 今天下午开始偏头痛, 注意力完全涣散。睡眠不足后的工作日, 有效产出只有正常时的六成。', expect: [['加班'], ['头痛'], ['睡眠']], forbid: ['22点'] },
    { id: 'ot-3-恶性循环', content: '加班到 22 点。到家改方案到 23:30, 躺下脑子里还在过排期, 结果失眠到快 1 点。白天咖啡续命, 下午又犯困。恶性循环: 加班→失眠→咖啡→低效→再加班。', expect: [['加班'], ['失眠'], ['咖啡']], forbid: ['22点', '23:30', '1点'] },
    { id: 'ot-4-晨跑', content: '停跑两个月, 今天重新开始: 3 公里, 配速 7 分, 心率 155。计划每周三跑: 周二四六。先恢复频率。', expect: [['晨跑', '跑步', '跑'], ['配速']], forbid: ['心率155', '周二', '周四', '周六', '3公里'] },
    { id: 'ot-5-睡不着', content: '关了灯躺下两个小时, 脑子里一直在过白天的对话和排期。明明很累, 就是停不下来。试过数呼吸, 数到 200 还是清醒。', expect: [['失眠', '睡不着', '入睡']], forbid: ['两个小时', '200'] },
    { id: 'ot-6-咖啡因', content: '怀疑下午咖啡影响夜间睡眠, 开始实验: 14 点后不碰咖啡因。第一周入睡提前 25 分钟, 但下午困得厉害。', expect: [['咖啡因'], ['睡眠']], forbid: ['14点', '25分钟'] },
    { id: 'ot-7-冥想', content: '跟着 app 做了一次 10 分钟冥想, 全程思绪乱飞, 但结束时确实安静了一点。决定先坚持一周, 目标是睡前冥想替代刷手机。', expect: [['冥想']], forbid: ['10分钟', 'app'] },
    { id: 'ot-8-碎片章节', content: '通勤 40 分钟, 把《深度工作》第 4 章读完了, 讲的是注意力残余和任务切换的代价, 正好对应最近的加班低效。', expect: [['深度工作'], ['注意力残余']], forbid: ['第4章', '40分钟'] },
  ],
  life: [
    { id: 'lt-1-托班第一周', content: '入园第一周实录: 每天早上在门口哭 20 分钟, 老师接过去后要哄好久。老师说这是正常的, 一般两周内会好转。', expect: [['托班', '入园'], ['分离焦虑', '哭']], forbid: ['20分钟', '两周'] },
    { id: 'lt-2-奶睡', content: '孩子习惯了含着奶睡, 一放下就醒, 夜里要反复喂。育儿嫂说这叫奶睡依赖, 要慢慢戒, 不能硬来。', expect: [['奶睡'], ['睡眠', '睡']], forbid: ['一放'] },
    { id: 'lt-3-夜醒咖啡', content: '连续一周, 孩子夜里醒两三次, 每次都要抱起来哄, 最长一次哄了一个小时。我白天全靠咖啡撑着。', expect: [['夜醒'], ['咖啡'], ['哄睡', '哄']], forbid: ['一小时'] },
    { id: 'lt-4-记账', content: '记账一周数据: 奶粉+尿布 680 元, 占总支出 31%。发现囤货打折时买能省 15%, 决定做一次季度集中采购。', expect: [['记账'], ['理财', '开销', '支出']], forbid: ['680元', '31%', '15%'] },
    { id: 'lt-5-分房', content: '本来计划这月让孩子分房睡, 结果他半夜醒了总抱着枕头来我房间。推了两周还没成。', expect: [['分房', '分房睡'], ['睡眠', '半夜', '夜醒']], forbid: ['两周', '这月'] },
    { id: 'lt-6-家长会', content: '家长会要点: 1) 周末也要按园里作息, 午睡 12:30-14:30; 2) 接送时间固定, 建立安全感。决定: 全家执行园里作息表。', expect: [['家长会'], ['作息', '午睡']], forbid: ['12:30', '14:30'] },
    { id: 'lt-7-工作失误', content: '今天评审会上走神, 漏掉了一个关键需求。复盘: 昨晚孩子醒了三次, 我凌晨 4 点才睡实。熬夜带娃→白天犯困→工作失误。', expect: [['失误', '需求'], ['带娃', '熬夜'], ['犯困', '睡眠']], forbid: ['凌晨4点', '三次'] },
    { id: 'lt-8-碎片章节', content: '通勤看完《真希望我父母读过这本书》第 2 章, 讲的是孩子的感受需要被确认, 而不是被纠正。正好对应最近的分离焦虑。', expect: [['真希望我父母读过这本书'], ['感受', '分离焦虑']], forbid: ['第2章', '通勤'] },
  ],
};
const DATASET = process.argv.includes('--dataset')
  ? process.argv[process.argv.indexOf('--dataset') + 1]
  : 'deepening';
const EXTRACT_CASES = DATASET_EXTRACT[DATASET] || DATASET_EXTRACT.deepening;

/** 每数据集的信号配置（L2 交叉验证：deepening 自测 + life 独立设计） */
const DATASET_SIGNALS = {
  deepening: {
    noiseTitles: ['窗外有只橘猫在晒太阳', '今天天气不错', '测试测试 123'],
    risingTheme: ['加班'],
    newTheme: ['冥想'],
    fallingTheme: ['健身', '运动', '精力'],
    semanticPairs: [
      ['冥想第三天', '下午昏沉记录'],
      ['加班复盘', '下午昏沉记录'],
    ],
    chainKeywords: ['加班', '睡眠', '咖啡因', '冥想'],
  },
  life: {
    noiseTitles: ['楼下桂花开了', '天气不错', '测试记录'],
    risingTheme: ['托班', '育儿'],
    newTheme: ['理财', '记账', '财务'],
    fallingTheme: ['社交', '聚餐'],
    semanticPairs: [
      ['夜醒', '奶睡'],
      ['奶睡', '分房'],
    ],
    chainKeywords: ['带娃', '咖啡', '失误'],
  },
};

const SIGNALS = DATASET_SIGNALS[DATASET] || DATASET_SIGNALS.deepening;
const NOISE_TITLES = SIGNALS.noiseTitles;
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

  const themeDir = (sum, names) => {
    for (const n of names) {
      const t = (sum.themes || []).find((x) => x.name.includes(n));
      if (t?.direction) return t.direction;
    }
    return null;
  };
  const allThemeNames = (sum) => (sum.themes || []).map((t) => t.name).join('、');
  const narrative = `${sum7.narrative || ''} ${sum30.narrative || ''}`;
  const highlights = [...(sum7.highlights || []), ...(sum30.highlights || [])].join(' ');

  // 信号 1: 升温主题 (7d)
  const ot = themeDir(sum7, SIGNALS.risingTheme);
  results.push([`升温主题(${SIGNALS.risingTheme[0]})(7d)`, ['up', 'new'].includes(ot), `direction=${ot} (themes: ${allThemeNames(sum7).slice(0, 60)})`]);

  // 信号 2: 新生主题 (7d) — themes 或 themeTrends 任一层
  const mt = themeDir(sum7, SIGNALS.newTheme);
  const mtTrend = (sum7.themeTrends || []).find((t) => SIGNALS.newTheme.some((k) => t.name.includes(k)));
  results.push([`新生主题(${SIGNALS.newTheme[0]})(7d)`, ['up', 'new'].includes(mt) || mtTrend?.direction === 'new', `themes=${mt} | themeTrends=${mtTrend ? `${mtTrend.name}(${mtTrend.recent}/${mtTrend.older}:${mtTrend.direction})` : '(无)'}`]);

  // 信号 3: 降温主题 (30d) — themes 或确定性 themeTrends 任一层检出（簇级）
  const ft = themeDir(sum30, SIGNALS.fallingTheme);
  const ftCluster = (sum30.themeTrends || []).find((t) => SIGNALS.fallingTheme.some((k) => t.name.includes(k)));
  const ftOk = ft === 'down' || ftCluster?.direction === 'down';
  results.push([`降温主题(${SIGNALS.fallingTheme[0]})(30d)`, ftOk, `themes=${ft} | themeTrends=${ftCluster ? `${ftCluster.name}(${ftCluster.recent}/${ftCluster.older}:${ftCluster.direction})` : '(无)'}`]);

  // 信号 4: 叙事包含因果链关键词 ≥2
  const chainHits = SIGNALS.chainKeywords.filter((k) => narrative.includes(k));
  results.push(['叙事因果链(≥2关键词)', chainHits.length >= 2, `命中 ${chainHits.join('、') || '(无)'}`]);
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

  // 信号 1: 语义对命中（簇）——设计对命中或机制命中任意非噪声对均算
  const semRecs = items.filter((r) => r.type === 'semantic');
  const semHits = SIGNALS.semanticPairs.filter(([a, b]) => allText.includes(a.slice(0, 6)) && allText.includes(b.slice(0, 6)));
  const semGenuine = semRecs.some((r) => {
    const t = r.title;
    return !NOISE_TITLES.some((n) => t.includes(n.slice(0, 4)));
  });
  const semDetail = semRecs.length
    ? semRecs.map((r) => r.title.split(' ↔ ').map((x) => x.slice(0, 10)).join('~')).join(' | ')
    : '(无)';
  results.push(['语义对(睡眠簇)', semHits.length >= 1 || semGenuine, `${semRecs.length} 条语义推荐 (设计对命中 ${semHits.length}, 真实对=${semGenuine}): ${semDetail}`]);

  // 信号 2: 形成主题（簇）
  const forming = items.filter((r) => r.type === 'forming');
  const themeCluster = [...SIGNALS.risingTheme, ...SIGNALS.newTheme];
  const formingHit = forming.some((r) => themeCluster.some((k) => r.title.includes(k)));
  results.push(['形成主题(簇)', formingHit, forming.map((r) => r.title).join('、') || '(无)']);

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
