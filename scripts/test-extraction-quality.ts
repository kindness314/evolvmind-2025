/**
 * 图谱抽取质量验证脚本
 * 对 30 条精心设计的输入逐一调用 /api/graph/extract，验证：
 * - 必须出现的节点 (mustHave: 子串匹配)
 * - 不能出现的节点 (mustNotHave: 精确匹配)
 * - 空结果是否正确 (nodes: [])
 *
 * 用法: npx tsx scripts/test-extraction-quality.ts
 */

const API = 'http://127.0.0.1:3000/api/graph/extract';
const SCOPE = '00000000-0000-0000-0000-000000000000';
const MODEL = 'MiniMax-M1-40k';

interface Expect {
  nodes?: never[];
  mustHave?: string[];
  mustNotHave?: string[];
}

interface TestCase {
  id: string;
  content: string;
  expect: Expect;
  desc: string;
}

type Verdict = 'PASS' | 'FAIL' | 'PARTIAL';

interface Result {
  id: string;
  desc: string;
  content: string;
  verdict: Verdict;
  nodes: string[];
  missing: string[];
  unwanted: string[];
  error?: string;
}

function checkSubstring(name: string, patterns: string[]): string[] {
  return patterns.filter((p) => {
    const lowerName = name.toLowerCase();
    const lowerP = p.toLowerCase();
    // 精确匹配或子串匹配
    return lowerName === lowerP || lowerName.includes(lowerP);
  });
}

function evaluate(tc: TestCase, nodeNames: string[]): Omit<Result, 'id' | 'desc' | 'content'> {
  // Case: expect exact empty
  if (tc.expect.nodes !== undefined) {
    if (nodeNames.length === 0) {
      return { verdict: 'PASS', nodes: nodeNames, missing: [], unwanted: [] };
    }
    return {
      verdict: 'FAIL',
      nodes: nodeNames,
      missing: [],
      unwanted: nodeNames,
    };
  }

  // Case: mustHave / mustNotHave
  const mustHave = tc.expect.mustHave ?? [];
  const mustNotHave = tc.expect.mustNotHave ?? [];

  const found: string[] = [];
  const missing: string[] = [];

  for (const mh of mustHave) {
    const matched = nodeNames.some((n) => {
      const nl = n.toLowerCase();
      const ml = mh.toLowerCase();
      return nl === ml || nl.includes(ml);
    });
    if (matched) found.push(mh);
    else missing.push(mh);
  }

  const unwanted: string[] = [];
  for (const mnh of mustNotHave) {
    if (nodeNames.some((n) => n === mnh)) {
      unwanted.push(mnh);
    }
  }

  if (missing.length === 0 && unwanted.length === 0) return { verdict: 'PASS', nodes: nodeNames, missing: [], unwanted: [] };
  if (missing.length > 0 && unwanted.length > 0) return { verdict: 'FAIL', nodes: nodeNames, missing, unwanted };
  return { verdict: 'PARTIAL', nodes: nodeNames, missing, unwanted };
}

async function runOne(tc: TestCase): Promise<Result> {
  const resp = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: tc.content, scope_id: SCOPE, model: MODEL }),
  });

  if (!resp.ok) {
    return {
      id: tc.id,
      desc: tc.desc,
      content: tc.content.slice(0, 80),
      verdict: 'FAIL',
      nodes: [],
      missing: [],
      unwanted: [],
      error: `HTTP ${resp.status}`,
    };
  }

  const json = await resp.json();
  const data = json.data;
  if (!data || !Array.isArray(data.nodes)) {
    return {
      id: tc.id,
      desc: tc.desc,
      content: tc.content.slice(0, 80),
      verdict: 'FAIL',
      nodes: [],
      missing: [],
      unwanted: [],
      error: 'Invalid response shape',
    };
  }

  const nodeNames: string[] = data.nodes.map((n: { name: string }) => n.name);
  const evalResult = evaluate(tc, nodeNames);
  return {
    id: tc.id,
    desc: tc.desc,
    content: tc.content.slice(0, 80),
    ...evalResult,
  };
}

// ==========================================================
// Test cases
// ==========================================================
const cases: TestCase[] = [
  // ===== 1-5: 纯噪声 — 应返回空图 =====
  { id: 'noise-1', content: '今天天气不错。', expect: { nodes: [] }, desc: '纯天气寒暄' },
  { id: 'noise-2', content: '下午去食堂吃饭，然后回宿舍睡觉。晚上继续写作业。', expect: { nodes: [] }, desc: '日常流水账' },
  { id: 'noise-3', content: '随便记点东西，没什么特别的。', expect: { nodes: [] }, desc: '无信息量填充' },
  { id: 'noise-4', content: '今天上午在公司开会，下午跟同事聊了聊，晚上回家。明天还得来。', expect: { nodes: [] }, desc: '公司日常' },
  { id: 'noise-5', content: '嗯，还行吧，就这样。', expect: { nodes: [] }, desc: '极短无意义' },

  // ===== 6-10: 噪声中混入信号 =====
  {
    id: 'mixed-1',
    content: '今天下午去星巴克中关村店跟张三讨论了下周的产品发布计划。睡眠质量还是很差，考虑买褪黑素。',
    expect: { mustHave: ['星巴克中关村店', '张三', '产品发布', '睡眠'], mustNotHave: ['今天', '下午', '公司', '那边'] },
    desc: '噪声+信号: 具体地点/人名/事件',
  },
  {
    id: 'mixed-2',
    content: '昨天看了《原子习惯》，里面讲到环境设计比意志力更重要。晚上去跑步，配速5分30秒。',
    expect: { mustHave: ['原子习惯', '环境设计', '意志力'], mustNotHave: ['昨天', '晚上', '跑步'] },
    desc: '书名/概念提取，日常动作过滤',
  },
  {
    id: 'mixed-3',
    content: '今天早上冥想15分钟，发现注意力比以前稳定。然后去公司，上午写了3个小时代码——重构了推荐引擎的相似度计算模块。',
    expect: { mustHave: ['冥想', '注意力', '推荐引擎', '相似度计算'], mustNotHave: ['今天', '早上', '公司'] },
    desc: '习惯+技术概念',
  },
  {
    id: 'mixed-4',
    content: '上周去了趟杭州，在西湖边上的茶馆待了一下午。思考了创业方向：AI+教育的结合点到底在哪里？',
    expect: { mustHave: ['杭州', '西湖', '创业', '教育'], mustNotHave: ['上周', '下午', '茶馆'] },
    desc: '具体城市/景点保留',
  },
  {
    id: 'mixed-5',
    content: '明天要交的方案还没写完，今晚又得熬夜了。核心问题是数据源的可信度怎么验证。',
    expect: { mustHave: ['数据源', '可信度', '方案'], mustNotHave: ['明天', '今晚', '熬夜'] },
    desc: '具体问题+文档名保留',
  },

  // ===== 11-15: 各种节点类型 =====
  {
    id: 'kind-person',
    content: '跟李四聊了1小时，发现他在系统架构方面很有见地。他说微服务的边界应该按业务能力划分而不是技术栈。',
    expect: { mustHave: ['李四', '微服务'], mustNotHave: ['我', '他'] },
    desc: 'person + concept',
  },
  {
    id: 'kind-event',
    content: '8月15日的季度复盘会改到线上进行了。大家对齐了Q3的OKR——重点是用户留存率要提升到40%。',
    expect: { mustHave: ['季度复盘会', 'OKR', '用户留存率'], mustNotHave: ['8月15日'] },
    desc: 'event + concept',
  },
  {
    id: 'kind-view',
    content: '我的观点：远程办公的效率其实比在办公室高，前提是异步沟通文化要建立起来。',
    expect: { mustHave: ['远程办公', '异步沟通'], mustNotHave: ['办公室', '我'] },
    desc: 'view/concept',
  },
  {
    id: 'kind-conclusion',
    content: '经过三周实验，结论是：每天专注4小时的产出远高于分散的8小时。决定从下周起实行深度工作时段。',
    expect: { mustHave: ['深度工作', '专注'], mustNotHave: ['下周', '三周'] },
    desc: 'conclusion + concept',
  },
  {
    id: 'kind-todo-question',
    content: '待办：周五前给王五发PR review意见。疑问：为什么我们的CI/CD流水线总是构建超时？是不是Docker层缓存没用好？',
    expect: { mustHave: ['PR', '王五', 'CI/CD', 'Docker'], mustNotHave: ['周五'] },
    desc: 'todo + question + person',
  },

  // ===== 16-20: 时间/地点边界 =====
  {
    id: 'edge-time-specific',
    content: '2026年春节回北京老家，跟老同学聚了一次。计划2027年春节去云南旅行。',
    expect: { mustHave: ['北京', '云南', '春节'], mustNotHave: ['老家', '老同学'] },
    desc: '具体城市+时间节点',
  },
  {
    id: 'edge-time-weekly',
    content: '每周五下午4点的Scrum站会总是拖到5点。建议改成周三上午10点。',
    expect: { mustHave: ['Scrum', '站会'], mustNotHave: ['周五', '下午', '周三', '上午', '4点', '5点', '10点'] },
    desc: '周期时间过滤',
  },
  {
    id: 'edge-location-specific',
    content: '今天在国家图书馆北区看了半天书。环境比星巴克安静多了。',
    expect: { mustHave: ['国家图书馆', '星巴克'], mustNotHave: ['今天', '半天'] },
    desc: '具体地点保留',
  },
  {
    id: 'edge-location-vague',
    content: '在家办公效率太低，考虑搬去附近的WeWork。那边的咖啡还不错。',
    expect: { mustHave: ['WeWork'], mustNotHave: ['家', '那边', '附近'] },
    desc: '泛称地点过滤',
  },
  {
    id: 'edge-ambiguous',
    content: '这周效率特别低。感觉是睡眠不足导致的。明天开始每天睡满7小时。',
    expect: { mustHave: ['睡眠', '效率'], mustNotHave: ['这周', '明天'] },
    desc: '模糊时间，核心概念保留',
  },

  // ===== 21-25: 技术/专业内容 =====
  {
    id: 'tech-1',
    content: '在考虑把 graph 抽取从一次 LLM 调用拆成两步：先 NER 识别实体，再关系抽取。参考了 Dify 的 workflow 设计。',
    expect: { mustHave: ['NER', 'Dify', 'workflow'] },
    desc: '技术名词',
  },
  {
    id: 'tech-2',
    content: 'Supabase RLS 策略写错了——应该用 auth.uid() 而不是从请求体获取 user_id。这是个安全隐患。',
    expect: { mustHave: ['Supabase', 'RLS', 'auth.uid', '安全隐患'] },
    desc: '安全概念',
  },
  {
    id: 'tech-3',
    content: '对比了 Pinecone 和 Milvus 的向量数据库方案。最终选 Pinecone，因为不用自己维护基础设施。',
    expect: { mustHave: ['Pinecone', 'Milvus', '向量数据库'] },
    desc: '向量数据库对比',
  },
  {
    id: 'tech-4',
    content: 'MiniMax 的 M2.5 模型在 JSON 输出稳定性上比 Doubao 好，但推理速度慢一倍。Token 消耗也更高。',
    expect: { mustHave: ['MiniMax', 'Doubao'] },
    desc: '模型名称',
  },
  {
    id: 'tech-5',
    content: 'Tailwind CSS 4 的 @theme 指令和 v3 的 tailwind.config.ts 完全不兼容。迁移成本比预期高。',
    expect: { mustHave: ['Tailwind', '@theme'] },
    desc: '技术细节',
  },

  // ===== 26-30: 边界情况 =====
  { id: 'edge-very-short', content: '失眠。', expect: { mustHave: ['失眠'] }, desc: '单概念短输入' },
  {
    id: 'edge-very-long',
    content:
      "今天完成了三件事：1) 修复了推荐算法的余弦相似度计算bug，原来是向量未归一化导致的；2) 跟产品经理对齐了下周迭代的范围——聚焦在图谱可视化和导出功能；3) 跑步10公里，发现新的跑鞋Nike Alphafly 3确实提升不小。另外，读完了《深度工作》第二章，卡尔·纽波特提出的'度量黑洞'概念很有意思——知识工作者的产出难以度量，导致大家倾向于用'可见忙碌'代替'真正产出'。这解释了我为什么总觉得开会太多。明天计划：上午写代码，下午去国家图书馆查一些资料，晚上约了张三讨论技术路线。",
    expect: {
      mustHave: ['余弦相似度', '图谱可视化', 'Nike', '深度工作', '度量黑洞', '国家图书馆'],
      mustNotHave: ['今天', '明天', '上午', '下午', '晚上'],
    },
    desc: '长文本多概念',
  },
  {
    id: 'edge-foreign-words',
    content: '读了 Paul Graham 的《How to Do Great Work》，核心观点：做大事最重要的是找到自己真正感兴趣的问题。这和之前读的 Ikigai 理念很像。',
    expect: { mustHave: ['Paul Graham', 'Ikigai'] },
    desc: '英文混排',
  },
  {
    id: 'edge-emoji-symbols',
    content: '今天心情😊。学会了用 Docker Compose 一键部署整个项目 🚀。TODO: 写 README 📝。',
    expect: { mustHave: ['Docker Compose', 'README'], mustNotHave: ['今天', 'TODO', '😊'] },
    desc: 'emoji + 英文混排',
  },
  {
    id: 'edge-numbers-only',
    content: '体重68.5kg，体脂率18.2%。上周是69.3kg/18.8%。趋势向好但太慢。目标65kg/15%。',
    expect: { mustHave: ['体重', '体脂率'] },
    desc: '数值型指标',
  },
];

// ==========================================================
// Runner
// ==========================================================
async function main() {
  console.log(`\n图谱抽取质量测试 — ${cases.length} 条用例\n`);
  console.log(`API: ${API} | Model: ${MODEL}\n`);
  console.log('='.repeat(72));

  const results: Result[] = [];
  let pass = 0;
  let partial = 0;
  let fail = 0;

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    const r = await runOne(tc);
    results.push(r);

    if (r.verdict === 'PASS') pass++;
    else if (r.verdict === 'PARTIAL') partial++;
    else fail++;

    const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'PARTIAL' ? '⚠️' : '❌';
    const pad = `${i + 1}`.padStart(2, '0');
    console.log(`\n${icon} [${pad}] ${tc.id} — ${r.verdict}`);
    console.log(`    ${tc.desc}`);
    console.log(`    输入: ${r.content}…`);
    console.log(`    节点: [${r.nodes.join(', ') || '(空)'}]`);
    if (r.missing.length) console.log(`    缺失: ${r.missing.join(', ')}`);
    if (r.unwanted.length) console.log(`    噪声: ${r.unwanted.join(', ')}`);
    if (r.error) console.log(`    错误: ${r.error}`);

    // 速率控制：避免触发 API 限流
    await new Promise((r) => setTimeout(r, 800));
  }

  // Summary
  console.log('\n' + '='.repeat(72));
  console.log(`\n总计: ${cases.length} | ✅ PASS: ${pass} | ⚠️ PARTIAL: ${partial} | ❌ FAIL: ${fail}`);
  console.log(`通过率: ${((pass / cases.length) * 100).toFixed(1)}%`);

  // Category breakdown
  const categories: Record<string, Result[]> = {};
  for (const r of results) {
    const cat = r.id.split('-')[0];
    (categories[cat] ??= []).push(r);
  }
  console.log('\n分类统计:');
  for (const [cat, rs] of Object.entries(categories)) {
    const catPass = rs.filter((r) => r.verdict === 'PASS').length;
    console.log(`  ${cat}: ${catPass}/${rs.length} pass`);
  }

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
