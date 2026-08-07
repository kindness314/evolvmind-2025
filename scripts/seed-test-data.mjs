#!/usr/bin/env node
/**
 * seed-test-data.mjs — 测试数据注入脚本（走正常处理链路）
 *
 * 用途: 为「总结与推送」验收注入有逻辑联系的数据集。数据按主题设计（详见 DATASETS 注释），
 *       每条记录走与前端 CapturePage 相同的完整链路:
 *   1. REST 插入 captured_info（demo: user_id 不传 → null，RLS demo 策略放行）
 *   2. POST 本地 /api/graph/extract（X-EvolvMind-Demo: true）→ LLM 抽取图谱
 *   3. 复刻 src/lib/graph.ts 的 applyGraphToSupabase 合并逻辑写 knowledge_nodes/links
 *   4. 新/变更节点 POST /api/graph/embed 生成节点 embedding
 *   5. captured 级 POST /api/embed 生成整条 embedding
 *   6. PATCH captured_info 三状态推进 completed
 *
 * 用法:
 *   node scripts/seed-test-data.mjs [--api http://127.0.0.1:3000] [--only N] [--dataset deep-work]
 *
 * 环境: 需在 EvolvMind/ 根目录执行（读取 .env.local 的 VITE_SUPABASE_PROJECT_ID/ANON_KEY）。
 * 密钥只在本进程内存使用，不打印、不落盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEMO_SCOPE = '00000000-0000-0000-0000-000000000000';

/* ---------------- 参数解析 ---------------- */
const args = process.argv.slice(2);
function argValue(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const API_BASE = argValue('--api', 'http://127.0.0.1:3000');
const ONLY = Number(argValue('--only', '0')) || 0; // >0 时只跑前 N 条
const DATASET = argValue('--dataset', 'deep-work');
const RESUME = args.includes('--resume'); // 幂等续跑: completed 跳过, 未完成行复用 id 重跑
const FILL_EMBEDS = args.includes('--fill-embeds'); // 补齐 demo scope 内 embedding 为空的节点

/* ---------------- 读 .env.local ---------------- */
function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv(path.join(REPO_ROOT, '.env.local'));
const PROJECT_ID = env.VITE_SUPABASE_PROJECT_ID || '';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';
if (!PROJECT_ID || !ANON_KEY) {
  console.error('缺少 VITE_SUPABASE_PROJECT_ID / VITE_SUPABASE_ANON_KEY（.env.local）');
  process.exit(1);
}
const SUPABASE_URL = `https://${PROJECT_ID}.supabase.co`;
const REST = `${SUPABASE_URL}/rest/v1`;
const REST_HEADERS = {
  'Content-Type': 'application/json',
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  Prefer: 'return=representation',
};

/* ---------------- 复刻 graph.ts 合并逻辑 ---------------- */
function normalizeName(input) {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:"'“”‘’（）()【】[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function uniqStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = (v || '').toString().trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
function kindPriority(kind) {
  switch (kind) {
    case 'person': return 10;
    case 'event': return 9;
    case 'object': return 8;
    case 'concept': return 7;
    case 'view': case 'conclusion': case 'todo': case 'question': return 6;
    case 'time': case 'location': return 5;
    default: return 0;
  }
}
function kindColor(kind) {
  switch (kind) {
    case 'person': return '#22C55E';
    case 'event': return '#F97316';
    case 'object': return '#14B8A6';
    case 'concept': return '#3B82F6';
    case 'view': return '#6366F1';
    case 'conclusion': return '#A855F7';
    case 'todo': return '#EF4444';
    case 'question': return '#0EA5E9';
    case 'time': return '#64748B';
    case 'location': return '#EAB308';
    default: return '#3B82F6';
  }
}
function kindVal(kind) {
  switch (kind) {
    case 'person': return 18;
    case 'event': return 16;
    case 'todo': return 16;
    case 'question': return 14;
    case 'conclusion': return 14;
    case 'view': return 13;
    case 'concept': return 12;
    case 'object': return 12;
    case 'location': return 11;
    case 'time': return 10;
    default: return 10;
  }
}
const linkKey = (source, target, rel) => `${source}::${target}::${rel}`;

/* ---------------- REST 工具 ---------------- */
async function rest(path, { method = 'GET', body } = {}) {
  const resp = await fetch(`${REST}${path}`, {
    method,
    headers: REST_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!resp.ok) {
    throw new Error(`REST ${method} ${path} -> ${resp.status}: ${typeof json === 'string' ? json : JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

/* ---------------- 本地 API 工具 ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function apiPost(route, body, timeoutMs = 90_000, retries = 3) {
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
        const err = new Error(`API POST ${route} -> ${resp.status}: ${typeof json === 'string' ? json : JSON.stringify(json).slice(0, 300)}`);
        if (resp.status === 429 || (json && json.code === 429)) err.isRateLimit = true;
        throw err;
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError' || !e.isRateLimit || attempt >= retries) throw e;
      const waitMs = (attempt + 1) * 15_000; // 15s / 30s / 45s 退避
      console.warn(`  ${route} 429 限流, ${waitMs / 1000}s 后重试 (${attempt + 1}/${retries})`);
      await sleep(waitMs);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ---------------- 数据设计: 第一套 = 单一深度主题 ---------------- */
/**
 * 主题: 深度工作 / 注意力管理
 * 逻辑联系设计:
 *  - 概念链: 深度工作 → 注意力残余 → 心流 → 浅层工作 → 时间块 → 仪式 → 断连 → 注意力税
 *  - 人物: 卡尔·纽波特(深度工作作者)、米哈里·契克森米哈赖(心流之父)、苏菲·勒鲁瓦(注意力残余研究)
 *  - 方法: 时间块计划、四种哲学(禁欲/双峰/节奏/记者)、番茄钟、数字断连、仪式
 *  - 反例/质疑: 深度工作是否适合所有人、断连的边际收益
 *  - 交叉引用: 多条内容互相点名概念/人物 → LLM 抽取同名节点 → 合并 → 跨条目链接
 *  - 标签: 部分词面重叠(深度工作)、部分语义相关但词面不同(专注/注意力/认知) → 测词面 vs 语义
 *  - 时间: 近 7 天 8 条 + 7~30 天 16 条, 覆盖 summarize 的 7d/30d 窗口
 */
const DATASETS = {
  'deep-work': [
    // ---- 7~30 天: 理论/人物/方法（建立概念底座）----
    {
      type: 'note',
      title: '深度工作的定义',
      content: '卡尔·纽波特在《深度工作》中给出的定义: 深度工作是在无干扰的专注状态下进行职业活动, 使认知能力达到极限。这种努力能够创造新价值, 提升技能, 且难以复制。与浅层工作相对, 深度工作是知识工作时代稀缺而昂贵的资源。纽波特的核心论点: 深度工作不是可选项, 而是现代经济中的超级力量。注意力被分散的人无法进入深度状态, 因此注意力残余是深度工作的头号敌人。',
      tags: ['深度工作', '专注', '知识工作', '卡尔·纽波特'],
      summary: '纽波特对深度工作的定义及其在知识经济中的价值。',
      daysAgo: 30,
    },
    {
      type: 'note',
      title: '注意力残余: 切换任务的隐性成本',
      content: '苏菲·勒鲁瓦(Sophie Leroy)的研究: 任务切换时, 前一个任务的注意力并不会立即释放, 而是残留(re attention residue)在脑海中, 降低后续任务的认知表现。研究表明, 即使只是快速查收邮件再回来, 也需要约 23 分钟才能完全恢复专注。这解释了为什么多任务切换是深度工作的大敌——每次切换都在支付隐性成本。对策是时间块: 把相似任务集中在一个完整时段处理。',
      tags: ['注意力', '任务切换', '认知科学', '苏菲·勒鲁瓦'],
      summary: '注意力残余效应: 任务切换的隐性认知成本与时间块对策。',
      daysAgo: 27,
    },
    {
      type: 'note',
      title: '心流状态: 深度工作的心理学底座',
      content: '米哈里·契克森米哈赖提出心流(flow): 当技能与挑战恰好匹配时, 人会进入完全沉浸、时间感消失的状态。心流的八个特征包括清晰目标、即时反馈、挑战与技能平衡。心流与深度工作的关系: 深度工作是通往心流的途径, 心流是深度工作的奖励。但二者不完全等同——深度工作强调价值产出, 心流强调主观体验。纽波特的观点是: 深度工作的目标不是追求心流, 而是产出有价值的结果。',
      tags: ['心流', '心理学', '创造力', '米哈里·契克森米哈赖'],
      summary: '心流的特征及其与深度工作的关系辨析。',
      daysAgo: 24,
    },
    {
      type: 'note',
      title: '浅层工作: 低认知价值的忙碌',
      content: '浅层工作(shallow work)指不需要高认知投入、容易复制的事务: 回邮件、开会、填表、刷消息。纽波特指出浅层工作的危险: 它给人"忙碌"的错觉, 却几乎不产生独特价值。知识工作者往往把大部分时间花在浅层工作上, 却误以为自己在高效。区分标准: 这项任务能否在数月后被一个训练有素的大学毕业生完成? 如果能, 就是浅层工作。深度工作与浅层工作的比例管理, 是时间管理的第一性原理。',
      tags: ['浅层工作', '深度工作', '效率'],
      summary: '浅层工作的定义、危险与区分标准。',
      daysAgo: 21,
    },
    {
      type: 'note',
      title: '时间块计划法: 对抗注意力残余的日程武器',
      content: '时间块(time-blocking)计划法: 把一天切成若干完整时段, 每个时段只分配给一个任务类型, 而非按任务清单逐条执行。纽波特把日程分为"深度工作块"与"浅层工作块", 每块 90 分钟左右。原理: 减少任务切换次数, 让注意力残余最小化。我打算把每天上午 8:30-11:30 设为雷打不动的深度块, 与之前笔记里提到的注意力残余研究相互印证。',
      tags: ['时间块', '计划', '时间管理'],
      summary: '时间块计划法的原理、日程切分方式与我的初步安排。',
      daysAgo: 19,
    },
    {
      type: 'note',
      title: '刻意练习与髓鞘质: 深度工作的神经基础',
      content: '安德斯·艾利克森(Anders Ericsson)的刻意练习理论: 高手不是靠天赋, 而是靠聚焦的重复练习。神经科学解释: 反复的专注练习会让神经纤维包裹髓鞘质, 提升信号传导速度。这意味着注意力本身就是一种可训练的能力——每次深度工作都在物理上强化大脑回路。这与深度工作理论互为支撑: 专注不仅产出价值, 还提升未来专注的能力。',
      tags: ['刻意练习', '神经科学', '专注'],
      summary: '刻意练习与髓鞘质理论: 注意力是可训练的能力。',
      daysAgo: 17,
    },
    {
      type: 'note',
      title: '深度工作的四种哲学: 禁欲/双峰/节奏/记者',
      content: '纽波特总结深度工作的四种时间哲学: 禁欲主义(彻底断联)、双峰主义(把时间分成深度与浅层两大块)、节奏主义(每天固定小段深度)、记者主义(随时见缝插针)。双峰主义最适合我这种需要协作的知识工作者: 每周挑两三个整天或半天做深度工作, 其余时间处理协作事务。它与时间块计划法天然兼容。',
      tags: ['深度工作', '双峰', '哲学'],
      summary: '四种深度工作哲学的对比, 双峰主义与我的场景匹配。',
      daysAgo: 15,
    },
    {
      type: 'note',
      title: '数字断连的边际收益: 对戒断运动的一点质疑',
      content: '数字戒断(digital detox)流行说法认为应彻底远离手机。但我怀疑边际收益递减: 对自制力弱的人, 彻底断连收益巨大; 对已建立专注习惯的人, 彻底断连的边际收益有限, 反而损失灵活性。更务实的做法是减少"注意力税"——关闭非必要通知、设定消息检查时间, 而非完全隔绝。这个质疑与深度工作理论并不矛盾, 只是对执行策略的修正。',
      tags: ['断连', '批判', '边际收益'],
      summary: '对数字戒断运动的批判: 边际收益递减, 务实优于彻底。',
      daysAgo: 20,
    },
    {
      type: 'note',
      title: '注意力税: 社交媒体如何收割专注力',
      content: '注意力经济时代, 社交媒体产品经理的 KPI 是用户停留时长。每一次通知、每一条信息流都在征收"注意力税"——把用户的注意力碎片化并转化为广告收入。被碎片化喂养的注意力无法完成深度工作, 这就是为什么很多知识工作者明明忙碌却产出寥寥。对策: 从制度上限制税源, 比如把社交媒体 App 移出首屏、设置使用限额。',
      tags: ['注意力', '社交媒体', '经济学'],
      summary: '注意力税机制: 社交媒体如何收割专注并侵蚀深度工作。',
      daysAgo: 13,
    },
    {
      type: 'note',
      title: '仪式感: 启动深度工作的触发器',
      content: '纽波特在《深度工作》中提到习惯化: 给深度工作设定固定的仪式, 让它像肌肉记忆一样自动启动。仪式可以是: 固定时间、固定地点、固定的启动动作(泡茶、戴耳机、开飞行模式)。仪式的作用是把"要不要开始"的意志力决策变成条件反射, 保存意志力用于真正的困难工作。',
      tags: ['仪式', '习惯', '深度工作'],
      summary: '用固定仪式触发深度工作, 把意志力决策变成条件反射。',
      daysAgo: 9,
    },
    {
      type: 'note',
      title: '深度工作与心流的区别: 一次概念澄清',
      content: '容易混淆的两个概念: 心流(米哈里)与深度工作(纽波特)。心流是沉浸体验, 深度工作是价值产出的工作方式。纽波特明确说: 不要为了心流而深度工作, 而要为产出而深度工作——心流只是副产品。例如写作难产时往往不在心流中, 但仍是深度工作。这个区分帮助我调整预期: 深度块不顺利不等于失败。',
      tags: ['深度工作', '心流', '对比'],
      summary: '深度工作与心流的概念区别: 价值产出 vs 沉浸体验。',
      daysAgo: 8,
    },
    {
      type: 'note',
      title: '卡尔·纽波特: 从程序员到专注力作家',
      content: '卡尔·纽波特(Cal Newport), 乔治城大学计算机科学教授, 先后写作《深度工作》《数字极简主义》《优秀到不能被忽视》。他的研究路径: 从程序员的时间管理困惑出发, 结合认知科学与自己的写作实践, 提出深度工作理论。纽波特本人践行极简数字生活: 几乎不用社交媒体, 每天固定深度写作时段。他的方法论的独特之处在于把"专注"从品德问题转化为工程问题。',
      tags: ['卡尔·纽波特', '深度工作', '作者'],
      summary: '纽波特的背景、著作与深度工作理论的由来。',
      daysAgo: 28,
    },
    {
      type: 'note',
      title: '米哈里·契克森米哈赖: 心流研究之父',
      content: '米哈里·契克森米哈赖(Mihaly Csikszentmihalyi), 匈牙利裔美国心理学家, 积极心理学奠基人之一。他通过"经验取样法"研究数千名艺术家、运动员、学者的巅峰状态, 提出心流理论, 代表作《心流: 最优体验心理学》。心流的可复制条件(明确目标、即时反馈、挑战-技能平衡)后来成为深度工作实践的重要参考。',
      tags: ['心流', '心理学家', '米哈里·契克森米哈赖'],
      summary: '米哈里的研究历程与心流理论的核心贡献。',
      daysAgo: 23,
    },
    {
      type: 'note',
      title: '工作记忆与认知负荷: 分心如何破坏思考',
      content: '认知心理学: 工作记忆容量有限(约 4 个组块), 任何分心刺激都会占用这个稀缺资源。加州大学欧文分校研究: 一次被打断后, 平均需要 23 分钟才能回到原有工作深度。频繁分心不仅浪费这 23 分钟, 还让工作记忆里的上下文反复丢失, 思维质量断崖式下降。这就是"分心成本"的神经机制, 与注意力残余研究结论一致。',
      tags: ['认知', '工作记忆', '注意力'],
      summary: '工作记忆限制与分心成本: 一次打断 23 分钟的代价。',
      daysAgo: 26,
    },
    // ---- 近 7 天: 实践/复盘/计划（检验时间窗口）----
    {
      type: 'note',
      title: '晨间深度工作块: 第一天实验记录',
      content: '按时间块计划法, 今天开始执行晨间深度块: 8:30-11:30, 手机飞行模式, 白噪音, 只做核心写作任务。实际结果: 前 40 分钟进入状态慢(注意力残余在作祟——昨晚刷了半小时社交媒体), 之后渐入佳境, 完成约 2 小时高质量产出。教训: 前一天晚上的信息摄入直接影响次日晨间深度块质量, 应配合数字断连。',
      tags: ['时间块', '晨间', '专注', '实践'],
      summary: '晨间深度块首日记录: 进入状态慢但产出可观。',
      daysAgo: 6,
    },
    {
      type: 'note',
      title: '深度工作复盘: 被打断五次的上午',
      content: '今天上午深度块彻底失败: 计划 3 小时, 实际被 5 次打断(两次消息、一次同事提问、一次快递、一次自己刷手机)。每次打断后重入状态平均 20 分钟, 一上午净深度时间不足 1 小时。这正好实证了工作记忆研究里"23 分钟重入成本"。改进: 深度块期间开勿扰模式并在工位挂"深度工作中"牌子, 把消息检查集中到中午。',
      tags: ['反思', '分心', '失败'],
      summary: '被打断五次的失败复盘, 实证 23 分钟重入成本。',
      daysAgo: 5,
    },
    {
      type: 'note',
      title: '番茄钟实验: 25 分钟冲刺与时间块之争',
      content: '对比实验: 今天下午用番茄钟(25 分钟工作+5 分钟休息)处理浅层工作清单。体验: 对浅层工作很有效, 心理负担小, 快速推进; 但对深度写作不适用——25 分钟刚进入状态就被迫中断, 打断感甚至强于外部打扰。结论: 番茄钟适合浅层工作, 时间块适合深度工作, 两者分工而非对立。',
      tags: ['番茄钟', '专注', '实验'],
      summary: '番茄钟实验: 适合浅层工作, 与时间块分工。',
      daysAgo: 5,
    },
    {
      type: 'note',
      title: '数字断连周末: 36 小时无手机实验',
      content: '执行数字断连周末: 周五 21:00 到周日 9:00 不碰手机, 电脑仅用于深度写作。观察: 第一天明显焦虑(戒断反应), 第二天注意力明显回升, 读完一本书, 完成两篇深度笔记(包括本系列的复盘)。印证了注意力税观点: 平时手机在持续征收认知资源, 断连后资源立即返还。',
      tags: ['断连', '注意力', '恢复'],
      summary: '36 小时数字断连实验: 戒断反应后注意力显著回升。',
      daysAgo: 3,
    },
    {
      type: 'note',
      title: '双峰周计划: 周二周四下午深度块',
      content: '采用双峰哲学制定本周计划: 周二、周四 13:30-17:00 深度块(共 7 小时), 其余时间处理协作与浅层工作。深度块内容: 周二写产品方案, 周四做代码重构。与晨间时间块互补: 晨间块用于个人学习, 双峰块用于团队产出。执行中需与同事约定深度块时间不被打扰。',
      tags: ['双峰', '计划', '深度工作'],
      summary: '双峰哲学周计划: 每周两个下午固定深度块。',
      daysAgo: 2,
    },
    {
      type: 'note',
      title: '我的深度工作仪式: 白噪音+热茶+飞行模式',
      content: '按仪式理论搭建个人启动触发器: 固定书桌、降噪耳机放白噪音、泡一杯热茶、手机飞行模式、打开写作软件全屏。这套动作约 3 分钟, 完成后大脑自动进入工作模式。实测一周, 启动失败率从 40% 降到 15%。仪式还帮助家人识别"勿扰"状态。',
      tags: ['仪式', '实践', '环境'],
      summary: '个人深度工作仪式搭建与一周实测效果。',
      daysAgo: 4,
    },
    {
      type: 'note',
      title: '本周深度工作复盘: 12 小时 vs 目标 15 小时',
      content: '本周数据: 深度工作 12 小时(目标 15), 分布在 5 个深度块; 主要缺口是周三被打断严重。产出: 1 份产品方案、1 次重构、4 篇深度笔记。对比上周 7 小时, 时间块+仪式组合有效。下周调整: 深度块从 90 分钟延长到 120 分钟, 并把周三设为"禁欲日"实验。',
      tags: ['复盘', '深度工作', '数据'],
      summary: '本周深度工作 12 小时复盘: 时间块+仪式有效, 下周实验禁欲日。',
      daysAgo: 1,
    },
    {
      type: 'note',
      title: '下月实验: 禁欲哲学周',
      content: '计划下月选一周做禁欲主义实验: 整周关闭社交媒体与消息通知, 每天 4 小时深度块, 其余时间阅读与思考。目的: 测试彻底断联状态下深度工作产出是否显著高于双峰模式。参照数字断连周末的经验, 预期前 1-2 天有戒断反应, 之后注意力资源显著增加。实验后对比周深度时长数据。',
      tags: ['禁欲', '实验', '计划'],
      summary: '下月禁欲哲学周实验计划: 对比双峰模式的产出。',
      daysAgo: 0,
    },
    {
      type: 'note',
      title: '注意力管理: 一生的复利杠杆',
      content: '整合本系列笔记: 深度工作、注意力残余、心流、时间块、仪式、断连、注意力税, 指向同一个结论——注意力是最稀缺的生产资料, 管理注意力就是管理一生的产出。纽波特把专注工程化, 米哈里给出沉浸的科学, 勒鲁瓦揭示切换的代价, 三者拼成完整拼图。行动原则: 减少切换、延长块、建立仪式、警惕注意力税。',
      tags: ['注意力', '结论', '长期'],
      summary: '本系列结论: 注意力是复利杠杆, 三大理论拼成完整拼图。',
      daysAgo: 7,
    },
    {
      type: 'note',
      title: '深度工作适合所有人吗: 对适用边界的质疑',
      content: '质疑视角: 深度工作理论预设了"产出可被评估、可深度思考"的知识工作场景。对客服、护士、急诊医生等必须随时响应、以交互为工作主体的职业, 深度工作策略并不直接适用。纽波特也承认这一点, 他的建议是"找到你的深度工作形式"。因此更准确的表述是: 每个人都需要发现属于自己的深度时刻, 而非教条地执行 90 分钟时间块。这个边界思考防止我把方法论变成教条。',
      tags: ['深度工作', '质疑', '适用性'],
      summary: '对深度工作适用边界的质疑: 交互型职业需要自己的形式。',
      daysAgo: 11,
    },
  ],
  'mesh': [
    // ============ 第二套: 多主题网状交叉 ============
    // 五个主题轴: 睡眠健康 / 工作职业 / 财务 / 家庭关系 / 学习阅读。
    // 设计要点:
    //   1. 跨主题枢纽记录(如 加班↔熬夜↔效率、晨间例行、陪伴↔分心、预算↔教育金)
    //      使图谱形成网状而非星型。
    //   2. 标签"语义相关但词面不同"(睡眠/恢复/精力 vs 熬夜/疲惫;
    //      预算/储蓄/理财 vs 开销/账单/消费), 用于检验语义化推荐
    //      是否能跨词面命中——表层标签匹配会 miss, embedding 相似度应能命中。
    // ---- 理论背景 (7~30 天) ----
    {
      type: 'note',
      title: '睡眠科学: 深睡期如何修复大脑',
      content: '睡眠周期约 90 分钟一轮, 深睡期(慢波睡眠)负责身体修复与记忆巩固, REM 期负责情绪调节。长期睡眠不足 6 小时, 前额叶功能下降, 决策和自控力都会受损。这解释了为什么睡不好时工作容易出错、更容易冲动消费。给睡眠优先级, 就是给白天的一切加杠杆。',
      tags: ['睡眠', '恢复', '认知'],
      summary: '深睡期修复大脑: 睡眠不足损伤决策与自控。',
      daysAgo: 26,
    },
    {
      type: 'note',
      title: '精力管理四维度: 体能情绪思维意志',
      content: '吉姆·洛尔的精力管理模型: 精力不是时间, 而是四个维度——体能(睡眠运动饮食)、情绪(积极关系)、思维(专注挑战)、意志(意义感)。任何一维亏空都会拖垮整体表现。方法: 规律睡眠、小睡充电、情绪事件簿、间歇切换任务。精力管理比时间管理更根本。',
      tags: ['精力', '管理', '健康'],
      summary: '精力四维度模型: 体能情绪思维意志, 精力优先于时间。',
      daysAgo: 24,
    },
    {
      type: 'note',
      title: '复利与被动收入: 财务自由的起点',
      content: '指数基金定投是普通人可用的复利工具: 长期持有宽基指数, 年化 8%-10%, 靠时间而非择时。被动收入 = 资产 × 收益率, 提升财务安全垫后, 面对高压工作更有选择权。关键不是赚多快, 而是储蓄率和纪律。',
      tags: ['理财', '复利', '储蓄'],
      summary: '指数定投与被动收入: 储蓄率与纪律决定财务安全垫。',
      daysAgo: 22,
    },
    {
      type: 'note',
      title: '非暴力沟通: 观察感受需要请求',
      content: '马歇尔·卢森堡的四要素: 描述观察(不带评判)、表达感受、说出需要、提出具体请求。家庭冲突大多源于评判和指责。例: "你这周加班三天, 我有点孤单, 我需要陪伴, 下周二一起吃饭好吗"而不是"你根本不关心家"。',
      tags: ['关系', '沟通', '家庭'],
      summary: '非暴力沟通四要素: 观察感受需要请求, 化解家庭冲突。',
      daysAgo: 20,
    },
    {
      type: 'note',
      title: '费曼学习法: 输出倒逼输入',
      content: '费曼技巧: 选概念→教给一个孩子→发现卡壳→回头重学→简化类比。检验是否真懂的唯一标准是能否讲清楚。用在职场上: 读完论文讲给同事听, 学完工具写篇教程, 理解深度完全不同。输出的痛苦正是学习的入口。',
      tags: ['学习', '输出', '方法'],
      summary: '费曼学习法: 用教别人的方式检验理解。',
      daysAgo: 18,
    },
    {
      type: 'note',
      title: '职业倦怠三特征: 耗竭愤世低效能',
      content: '倦怠不是累, 是长期压力下的三连: 情感耗竭、去人格化(愤世嫉俗)、低成就感。诱因常是工作量超载、控制感缺失、价值不匹配。识别信号: 早上不想起床、对同事冷漠、觉得做什么都没意义。应对: 降低强度、重建边界、找回意义感。',
      tags: ['工作', '倦怠', '压力'],
      summary: '职业倦怠三特征识别: 耗竭愤世低效能, 源于超载与失权。',
      daysAgo: 16,
    },
    {
      type: 'note',
      title: '极简主义消费观: 拥有越少越自由',
      content: '极简不是苦行, 是厘清"我需要什么"。消费主义用广告制造焦虑, 让人用购买填补空虚。极简消费原则: 一进一出、租借替代购买、为体验花钱而非物品。省下的不只是钱, 还有收纳时间和决策精力。',
      tags: ['消费', '极简', '理念'],
      summary: '极简消费: 一进一出, 为体验花钱, 省下钱与精力。',
      daysAgo: 15,
    },
    // ---- 跨主题枢纽记录 (7~14 天, 网状连接点) ----
    {
      type: 'note',
      title: '加班与熬夜的恶性循环: 效率反而下降',
      content: '连续三周赶项目, 每晚加班到 11 点, 睡眠压到 5 小时。结果: 白天开会走神、代码 bug 率上升、改 bug 又加班, 恶性循环。对比数据: 睡眠 7 小时的工作日, 有效产出是熬夜日的 1.4 倍。熬夜换来的时间, 被低效全部吃掉。',
      tags: ['加班', '熬夜', '效率'],
      summary: '加班→熬夜→低效→更多加班: 睡眠不足侵蚀产出。',
      daysAgo: 12,
    },
    {
      type: 'note',
      title: '晨间例行程序: 运动阅读规划三件套',
      content: '把晨间 90 分钟固定为: 30 分钟快走(体能激活)、20 分钟阅读(输入)、40 分钟当日规划(最重要任务优先)。执行两周后发现: 白天的焦虑显著下降, 因为最重要的事在早上 8 点前就推进了。晨间例行是精力管理与时间管理的交汇点。',
      tags: ['晨间', '例行', '规划'],
      summary: '晨间三件套: 运动+阅读+规划, 白天焦虑显著下降。',
      daysAgo: 11,
    },
    {
      type: 'note',
      title: '打车外卖账单暴增: 加班的经济代价',
      content: '复盘本月账单: 深夜加班打车 480 元, 外卖 620 元, 都是以前没有的。加班→没时间做饭→外卖, 加班→太晚→打车。这些开销看似零碎, 一年累计超过 1.3 万, 相当于一次旅行。省下它们的办法不是抠, 而是减少加班本身。',
      tags: ['开销', '账单', '消费'],
      summary: '加班连锁成本: 外卖+打车月增千元, 源头是加班本身。',
      daysAgo: 10,
    },
    {
      type: 'note',
      title: '陪家人吃饭还在刷手机: 在场不在线',
      content: '晚饭时孩子讲了三次学校的事, 我都在回消息。放下手机才意识到错过了什么。研究说家长手机使用会降低亲子互动质量, 孩子感受到的是"不被重视"。约定: 餐桌无手机, 消息统一 9 点后处理。专注不只是工作能力, 也是爱的能力。',
      tags: ['陪伴', '分心', '手机'],
      summary: '餐桌刷手机伤害亲子质量: 在场不在线, 约定无手机晚餐。',
      daysAgo: 9,
    },
    {
      type: 'note',
      title: '体检报告: 轻度脂肪肝与颈椎预警',
      content: '年度体检: 轻度脂肪肝、颈椎生理曲度变直、甘油三酯偏高。医生建议: 每周 3 次有氧、减少久坐、控制晚餐油盐。工作是干不完的, 身体是唯一的。健康指标恶化直接关联久坐加班和外卖饮食, 和前面笔记的加班链条完全吻合。',
      tags: ['体检', '健康', '风险'],
      summary: '体检预警: 脂肪肝颈椎问题, 直接关联久坐加班与外卖。',
      daysAgo: 8,
    },
    {
      type: 'note',
      title: '读《被讨厌的勇气》: 课题分离改善关系',
      content: '阿德勒心理学的课题分离: 分清"这是谁的课题", 不为别人的期待活, 也不干涉别人的课题。应用到家庭: 父母的焦虑是父母的课题, 我的职业选择是我的课题; 应用到工作: 领导的不满是他的课题, 我做好本分即可。减少内耗后, 关系反而更轻松。',
      tags: ['阅读', '课题分离', '关系'],
      summary: '课题分离: 分清谁的课题, 减少内耗, 关系更轻松。',
      daysAgo: 7,
    },
    // ---- 近期实践 (0~6 天, 检验时间窗口) ----
    {
      type: 'note',
      title: '跑步一周: 精力回升的量化数据',
      content: '开始晨跑(3km/天, 配速 6 分半)整一周。数据: 白天困倦感从每天 3 次降到 1 次, 下午 3 点不再需要咖啡, 晚上入睡更快。心率静息从 68 降到 62。运动对精力的提升比任何提神工具都可靠, 而且免费。',
      tags: ['运动', '精力', '数据'],
      summary: '晨跑一周量化: 困倦减半, 静息心率下降, 精力回升。',
      daysAgo: 6,
    },
    {
      type: 'note',
      title: '书桌断舍离与数字极简: 环境即注意力',
      content: '把书桌清空到只剩电脑水杯台灯, 手机移出书房, 浏览器只留工作标签页。环境变干净后, 开写前的心理阻力明显变小。数字极简: 关掉所有非必要通知, 卸载短视频。环境管理是注意力的物理基础设施。',
      tags: ['极简', '专注', '环境'],
      summary: '物理环境断舍离+数字极简: 减少开写阻力, 保护注意力。',
      daysAgo: 5,
    },
    {
      type: 'note',
      title: '记账 App 复盘: 开销分类占比',
      content: '用记账 app 一个月, 分类占比: 餐饮 28%(含外卖 40%)、居住 35%、交通 8%、娱乐 6%、学习 5%。最意外的是外卖占餐饮近半。调整: 工作日带饭 3 天, 预计月省 500。记账本身不省钱, 复盘后的行为改变才省钱。',
      tags: ['记账', '预算', '复盘'],
      summary: '记账月复盘: 外卖占餐饮四成, 带饭月省五百。',
      daysAgo: 5,
    },
    {
      type: 'note',
      title: '无手机晚餐实验: 深度陪伴 60 分钟',
      content: '昨晚全家执行无手机晚餐: 手机放玄关篮子里, 饭桌只聊天。孩子讲了学校运动会, 爱人聊了工作烦恼, 我们复盘了上次旅行的照片。结束时孩子说"今晚真开心"。同样的 60 分钟, 有没有手机, 质量完全不同。',
      tags: ['陪伴', '家庭', '实验'],
      summary: '无手机晚餐实验: 60 分钟深度陪伴, 孩子反馈真开心。',
      daysAgo: 4,
    },
    {
      type: 'note',
      title: '学习投资评估: 报课的账该怎么算',
      content: '想报一个数据分析课(3200 元, 12 周)。用费曼检验: 先看大纲能否自学? 已有免费资源占 60%。结论: 只报后半段进阶模块(1400 元), 前段自学。学习的钱要花在"省时间的反馈"上, 而不是"买课程"本身。',
      tags: ['学习', '投资', '评估'],
      summary: '报课评估: 3200 元课砍到 1400, 钱花在反馈而非课程本身。',
      daysAgo: 4,
    },
    {
      type: 'note',
      title: '午间小睡 20 分钟: 下午效率对比',
      content: '试验一周午间小睡 20 分钟(设闹钟, 躺椅, 不睡过 30 分钟避免惰性): 下午 14:00-16:00 的专注时长从 40 分钟提升到 75 分钟, 困倦感消失。小睡是精力的再充电, 比咖啡长效且无副作用。前提是控制时长, 超过 30 分钟反而昏沉。',
      tags: ['小睡', '精力', '效率'],
      summary: '午间小睡 20 分钟: 下午专注时长近乎翻倍。',
      daysAgo: 3,
    },
    {
      type: 'note',
      title: '家庭预算会议: 教育金与旅游基金',
      content: '和爱人开了第一次家庭预算会: 列出年度刚性支出(房贷教育保险), 结余分三份——应急金 40%、教育金 35%、旅游基金 25%。争论点是旅游占比, 最终用"先存后花"原则达成一致: 每年 11 月看余额决定。家庭财务透明本身就是一种陪伴。',
      tags: ['预算', '家庭', '规划'],
      summary: '家庭预算会: 结余三分法, 先存后花, 财务透明即陪伴。',
      daysAgo: 2,
    },
    {
      type: 'note',
      title: '工作日深度任务 vs 浅层任务: 时间日志',
      content: '连续记录 5 个工作日时间: 平均每天深度任务(写方案/写代码)仅 2.1 小时, 浅层任务(开会/邮件/即时消息)占 4.7 小时。会议越多, 深度时段被切得越碎。对策: 上午 9-11 点设为无会议时段, 消息集中 11:30 和 17:00 处理。',
      tags: ['工作', '效率', '时间'],
      summary: '时间日志: 深度任务仅 2.1h/天, 无会议时段+消息批处理。',
      daysAgo: 2,
    },
    {
      type: 'note',
      title: '一周复盘: 精力财务陪伴三角',
      content: '本周复盘三个互相关联的指标: 精力(睡眠 6.8h/晚, 运动 4 次, 达标)、财务(开销 -8%, 外卖减半, 达标)、陪伴(无手机晚餐 3 次, 达标)。发现三个维度互相加强: 睡好了→不焦虑→不靠外卖和刷手机补偿→陪伴质量高。下周保持, 重点补学习维度。',
      tags: ['复盘', '平衡', '健康'],
      summary: '周复盘: 精力财务陪伴三角互相加强, 下周补学习维度。',
      daysAgo: 1,
    },
    {
      type: 'note',
      title: '下月实验: 睡眠银行计划',
      content: '计划下月执行"睡眠银行": 目标是每晚 7.5 小时睡眠, 用周末补觉偿还工作日债, 睡前 30 分钟无屏幕、咖啡因 14 点后禁。预期效果: 结合前面积累的精力数据, 检验睡眠对工作效率和消费冲动的影响。实验设计: 前两周基线, 后两周干预, 对比专注时长与外卖账单。',
      tags: ['睡眠', '实验', '计划'],
      summary: '下月睡眠银行实验: 基线 vs 干预, 对比专注与消费。',
      daysAgo: 0,
    },
    {
      type: 'note',
      title: '五维平衡季度回顾: 健康工作财务关系学习',
      content: '季度五维自评: 健康 7/10(睡眠运动有改善)、工作 6/10(效率提升但加班仍多)、财务 6/10(储蓄率 20%, 目标 25%)、关系 7/10(无手机晚餐见效)、学习 5/10(读了两本书, 输出不足)。下季度联动计划: 减少加班→提升睡眠→降低外卖→省下预算→报课学习, 五维是一条链, 不是五个孤立目标。',
      tags: ['回顾', '五维', '计划'],
      summary: '季度五维回顾: 五维是一条互相影响的链, 联动改进。',
      daysAgo: 0,
    },
  ],
  'noise': [
    // ---- 信号: 8 条, 延续既有主题轴, 有明确标签 ----
    {
      type: 'note',
      title: '睡眠银行实验第二周: 入睡时间与晨起精力',
      content: '第二周数据: 8 天早于 23:30 入睡, 平均入睡 23:10, 晨起精力自评 7.5/10(上周 6.8)。发现: 睡前 30 分钟不看屏幕的晚上, 入睡时间平均提前 25 分钟。本周继续执行, 目标把平均入睡提前到 23:00。',
      tags: ['睡眠', '实验', '数据'],
      summary: '睡眠银行第二周: 早睡 8 天, 精力自评升到 7.5, 睡前不看屏幕有效。',
      daysAgo: 2,
    },
    {
      type: 'note',
      title: '六月家庭预算复盘: 实际 vs 计划',
      content: '六月预算复盘: 餐饮 1800(预算 2000, 节余), 教育金 1200(比计划多存 5%), 娱乐 350(预算 500)。超支项只有交通(多 200, 出差)。结论: 预算结构健康, 七月把餐饮节余转入"学习基金"。',
      tags: ['财务', '家庭', '复盘'],
      summary: '六月预算健康, 餐饮节余转入学习基金。',
      daysAgo: 4,
    },
    {
      type: 'note',
      title: '无手机晚餐坚持 30 天: 对话质量变化',
      content: '无手机晚餐满 30 天。观察: 第一周尴尬, 第二周开始聊工作以外的话题, 第三周孩子主动分享学校的事。现在每周至少 4 晚执行。成本: 偶尔错过消息, 收益: 家庭对话深度明显提升。',
      tags: ['家庭', '实验'],
      summary: '无手机晚餐 30 天: 家庭对话深度明显提升, 每周 4 晚。',
      daysAgo: 5,
    },
    {
      type: 'note',
      title: '深度工作周报: 四象限实践',
      content: '本周深度工作 18 小时(目标 15)。四象限分类执行: 重要不紧急 11h, 重要紧急 5h, 其余 2h。发现: 上午 9-11 点效率最高, 已把写作任务固定在这个时段。下周目标: 把会议压缩到每天 1 小时以内。',
      tags: ['工作', '效率', '复盘'],
      summary: '深度工作 18 小时, 上午 9-11 点效率最高。',
      daysAgo: 1,
    },
    {
      type: 'note',
      title: '读书笔记《稀缺》: 带宽与余闲',
      content: '《稀缺》核心: 稀缺心态消耗认知带宽, 导致管窥效应。应用于自己: 时间表塞满=带宽不足, 反而做不好重要事。行动: 每周留 2 个"余闲"时段不排任务, 用于思考和缓冲。',
      tags: ['学习', '阅读'],
      summary: '《稀缺》: 留余闲时段对抗带宽不足。',
      daysAgo: 6,
    },
    {
      type: 'note',
      title: '晨间例行动作微调: 冥想替代刷手机',
      content: '晨间例行 V3: 起床后冥想 15 分钟替代原来刷手机的 20 分钟。执行 5 天: 白天专注度有改善, 上午不需要咖啡也能清醒。保留动作: 冥想 → 喝一杯水 → 列今日三件事。',
      tags: ['习惯', '精力'],
      summary: '晨间冥想替代刷手机, 专注度改善。',
      daysAgo: 3,
    },
    {
      type: 'note',
      title: '外卖 vs 做饭成本对比: 每月省 800',
      content: '一个月对比: 外卖日均 55 元, 自己做饭日均 28 元, 每月省约 800 元, 且体重降了 2kg。执行成本: 周末备菜 2 小时。已加入家庭预算计划, 七月继续。',
      tags: ['财务', '健康'],
      summary: '做饭比外卖每月省 800 元, 附带健康收益。',
      daysAgo: 7,
    },
    {
      type: 'note',
      title: '加班与睡眠因果记录: 三周数据',
      content: '三周对照: 加班到 22 点后的晚上, 平均入睡 00:40, 次日精力自评 5.2; 不加班的晚上入睡 23:10, 精力 7.1。加班日的次日深度工作只有 1.5h。结论: 加班是时间错觉, 长期总产出更少。',
      tags: ['工作', '睡眠'],
      summary: '三周数据: 加班日次日效率腰斩, 加班是时间错觉。',
      daysAgo: 0,
    },
    // ---- 碎片: 8 条, 浅记录, 部分无标签 ----
    {
      type: 'note',
      title: '地铁上读完了一章',
      content: '通勤时把《深度工作》第 4 章读完了, 讲注意力残余。',
      tags: ['阅读'],
      summary: '通勤读完《深度工作》第 4 章。',
      daysAgo: 2,
    },
    {
      type: 'note',
      title: '感觉最近效率还行',
      content: '今天状态不错, 任务都按计划完成了。',
      tags: [],
      summary: '今天任务都完成了。',
      daysAgo: 3,
    },
    {
      type: 'note',
      title: '午饭吃了食堂',
      content: '今天食堂有红烧肉, 还不错。',
      tags: [],
      summary: '食堂午饭。',
      daysAgo: 1,
    },
    {
      type: 'note',
      title: '想买个机械键盘',
      content: '看中一款 87 键的茶轴, 价格 400 左右, 先加购物车。',
      tags: ['购物'],
      summary: '种草机械键盘。',
      daysAgo: 4,
    },
    {
      type: 'note',
      title: '跑步 5 公里',
      content: '配速 6 分半, 比上周慢了 20 秒, 有点累。',
      tags: ['运动'],
      summary: '跑步 5 公里, 配速一般。',
      daysAgo: 2,
    },
    {
      type: 'note',
      title: '会议又超时了',
      content: '下午的会开了 2 小时, 原计划 1 小时。',
      tags: [],
      summary: '会议超时 1 小时。',
      daysAgo: 0,
    },
    {
      type: 'note',
      title: '咖啡喝多了晚上睡不着',
      content: '下午 4 点后喝了第二杯, 现在很清醒。下次注意。',
      tags: ['睡眠'],
      summary: '下午喝咖啡影响睡眠。',
      daysAgo: 1,
    },
    {
      type: 'note',
      title: '整理了书桌',
      content: '扔了一批旧文件, 桌面清爽多了。',
      tags: [],
      summary: '整理书桌。',
      daysAgo: 5,
    },
    // ---- 噪声: 8 条, 无关/无意义/无标签 ----
    {
      type: 'note',
      title: '窗外有只猫在晒太阳',
      content: '橘猫, 趴了一下午。',
      tags: [],
      summary: '窗外的猫。',
      daysAgo: 3,
    },
    {
      type: 'note',
      title: '今天天气不错',
      content: '晴, 26 度。',
      tags: [],
      summary: '晴天。',
      daysAgo: 2,
    },
    {
      type: 'note',
      title: '测试测试 123',
      content: '测试一下这个功能能不能用。',
      tags: [],
      summary: '功能测试。',
      daysAgo: 1,
    },
    {
      type: 'note',
      title: '随便记点东西',
      content: '没什么特别的, 就是试试。',
      tags: [],
      summary: '无内容。',
      daysAgo: 0,
    },
    {
      type: 'note',
      title: '网购的快递到了三个',
      content: '两个日用品, 一个零食, 都放门口了。',
      tags: ['购物'],
      summary: '收了三个快递。',
      daysAgo: 6,
    },
    {
      type: 'note',
      title: '隔壁装修好吵',
      content: '电钻声一整天, 没法在家待着。',
      tags: [],
      summary: '邻居装修噪音。',
      daysAgo: 2,
    },
    {
      type: 'note',
      title: '想起了小时候的事',
      content: '小时候暑假在奶奶家, 冰棍和蝉鸣。',
      tags: [],
      summary: '回忆童年。',
      daysAgo: 4,
    },
    {
      type: 'note',
      title: '无意义记录一条',
      content: '这条记录没有信息量。',
      tags: [],
      summary: '无信息量记录。',
      daysAgo: 0,
    },
  ],
};

/* ---------------- 合并写入（复刻 applyGraphToSupabase） ---------------- */
async function applyGraph(graph, capturedId) {
  // 1. 现有节点
  const existingNodes = await rest(
    `/knowledge_nodes?scope_id=eq.${DEMO_SCOPE}&select=id,name,normalized_name,kind,aliases,source_captured_ids,val,color`,
  );
  const normToNode = new Map();
  for (const n of existingNodes || []) {
    const norm = n.normalized_name || normalizeName(n.name);
    if (norm) normToNode.set(norm, n);
    for (const a of n.aliases || []) {
      const an = normalizeName(a);
      if (an && !normToNode.has(an)) normToNode.set(an, n);
    }
  }

  const extractedIdToDbId = new Map();
  const changedNodeIds = new Set();

  for (const node of graph.nodes || []) {
    const names = uniqStrings([node.name, ...(node.aliases || [])]);
    const norms = uniqStrings(names.map(normalizeName)).filter(Boolean);
    const primaryNorm = normalizeName(node.name);

    let hit;
    for (const n of norms) {
      const maybe = normToNode.get(n);
      if (maybe) { hit = maybe; break; }
    }

    if (hit) {
      const mergedAliases = uniqStrings([...(hit.aliases || []), ...names].filter((s) => s !== hit.name));
      const nextKind = kindPriority(node.kind) > kindPriority(hit.kind || 'concept') ? node.kind : hit.kind || 'concept';
      const mergedCapturedIds = capturedId
        ? uniqStrings([...(hit.source_captured_ids || []), capturedId])
        : (hit.source_captured_ids || []);
      await rest(`/knowledge_nodes?id=eq.${hit.id}`, {
        method: 'PATCH',
        body: {
          kind: nextKind,
          aliases: mergedAliases,
          normalized_name: hit.normalized_name || normalizeName(hit.name),
          source_captured_ids: mergedCapturedIds,
          color: hit.color || kindColor(nextKind),
          val: hit.val || kindVal(nextKind),
          updated_at: new Date().toISOString(),
        },
      });
      extractedIdToDbId.set(node.id, hit.id);
      changedNodeIds.add(hit.id);
      if (primaryNorm) normToNode.set(primaryNorm, hit);
      for (const n of norms) normToNode.set(n, hit);
      continue;
    }

    const payload = {
      name: node.name,
      normalized_name: primaryNorm || normalizeName(node.name),
      kind: node.kind,
      aliases: uniqStrings((node.aliases || []).filter((s) => s !== node.name)),
      source_captured_ids: capturedId ? [capturedId] : [],
      color: kindColor(node.kind),
      val: kindVal(node.kind),
      updated_at: new Date().toISOString(),
    };
    const created = await rest('/knowledge_nodes?select=id', { method: 'POST', body: payload });
    const createdRow = Array.isArray(created) ? created[0] : created;
    extractedIdToDbId.set(node.id, createdRow.id);
    changedNodeIds.add(createdRow.id);
    for (const n of norms) normToNode.set(n, { ...payload, id: createdRow.id });
  }

  // 2. 链接
  const existingLinks = await rest(
    `/knowledge_links?scope_id=eq.${DEMO_SCOPE}&select=id,source,target,relation_type,evidence_captured_ids`,
  );
  const dedupe = new Map();
  for (const l of existingLinks || []) {
    dedupe.set(linkKey(l.source, l.target, l.relation_type || 'related_to'), l);
  }

  let insertedLinks = 0;
  let updatedLinks = 0;
  for (const link of graph.links || []) {
    const source = extractedIdToDbId.get(link.source);
    const target = extractedIdToDbId.get(link.target);
    if (!source || !target) continue;
    const rel = link.type || 'related_to';
    const key = linkKey(source, target, rel);
    const hit = dedupe.get(key);
    if (hit) {
      if (!capturedId) continue;
      const mergedEvidence = uniqStrings([...(hit.evidence_captured_ids || []), capturedId]);
      await rest(`/knowledge_links?id=eq.${hit.id}`, {
        method: 'PATCH',
        body: { evidence_captured_ids: mergedEvidence, updated_at: new Date().toISOString() },
      });
      updatedLinks++;
      continue;
    }
    await rest('/knowledge_links', {
      method: 'POST',
      body: {
        source,
        target,
        relation_type: rel,
        evidence_captured_ids: capturedId ? [capturedId] : [],
        confidence: typeof link.confidence === 'number' ? link.confidence : null,
        metadata: link.evidence ? { evidence: link.evidence } : {},
        updated_at: new Date().toISOString(),
      },
    });
    insertedLinks++;
  }

  return { changedNodeIds, insertedLinks, updatedLinks };
}
/* ---------------- 主流程 ---------------- */
async function findExistingCaptured() {
  // resume 幂等: 按 title 匹配 demo scope 已有行
  try {
    const rows = await rest('/captured_info?select=id,title,processing_status,graph_status&user_id=is.null');
    const map = new Map();
    for (const r of rows || []) map.set(r.title.trim(), r);
    return map;
  } catch (e) {
    console.warn(`  resume 预检失败(按全量插入继续): ${e.message}`);
    return new Map();
  }
}

async function seedOne(item, index, existing) {
  const createdAt = new Date(Date.now() - item.daysAgo * 24 * 3600 * 1000).toISOString();
  console.log(`\n[${index}] ${item.title} (${item.daysAgo}d 前)`);

  // 1. captured_info: resume 模式复用未完成行, 跳过已完成行
  let capturedId = null;
  if (existing) {
    if (existing.processing_status === 'completed') {
      console.log(`  已 completed, 跳过（resume）`);
      return { capturedId: existing.id, skipped: true };
    }
    capturedId = existing.id;
    console.log(`  复用已有行 id=${capturedId}, 重置状态重跑`);
    await rest(`/captured_info?id=eq.${capturedId}`, {
      method: 'PATCH',
      body: { processing_status: 'processing', graph_status: 'pending', embedding_status: 'pending' },
    });
  } else {
    const inserted = await rest('/captured_info?select=id', {
      method: 'POST',
      body: {
        type: item.type,
        title: item.title,
        content: item.content,
        summary: item.summary,
        tags: item.tags,
        created_at: createdAt,
        processing_status: 'processing',
        graph_status: 'pending',
        embedding_status: 'pending',
      },
    });
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    capturedId = row.id;
    console.log(`  captured_info id=${capturedId}`);
  }

  // 2. LLM 抽取图谱（content 拼法与前端 retryGraphForCaptured 一致）
  const contentForGraph = `标题: ${item.title}\n摘要: ${item.summary}\n关键词: ${(item.tags || []).join(', ')}\n资源: ${item.content}`;
  const extractResult = await apiPost('/api/graph/extract', { content: contentForGraph });
  const graph = extractResult?.data || {};
  const nodeCount = (graph.nodes || []).length;
  const linkCount = (graph.links || []).length;
  console.log(`  extract: ${nodeCount} 节点, ${linkCount} 链接 (model=${extractResult?.model || '?'})`);

  // 3. 合并写入（复刻 applyGraphToSupabase）
  const merged = await applyGraph(graph, capturedId);
  console.log(`  merge: +${merged.insertedLinks} 链接, 更新 ${merged.updatedLinks}, 变更节点 ${merged.changedNodeIds.size}`);

  // 4. 节点 embedding（逐节点, 429 自动退避重试）
  let embedOk = 0;
  for (const nodeId of merged.changedNodeIds) {
    try {
      await apiPost('/api/graph/embed', { node_id: nodeId }, 60_000, 3);
      embedOk++;
    } catch (e) {
      console.warn(`  embed 节点 ${nodeId} 失败: ${e.message}`);
    }
  }
  console.log(`  embed: ${embedOk}/${merged.changedNodeIds.size} 节点`);

  // 5. captured 级 embedding
  try {
    await apiPost('/api/embed', { captured_id: capturedId }, 60_000, 3);
  } catch (e) {
    console.warn(`  embed captured 失败: ${e.message}`);
  }

  // 6. 三状态推进 completed
  await rest(`/captured_info?id=eq.${capturedId}`, {
    method: 'PATCH',
    body: {
      processing_status: 'completed',
      graph_status: 'completed',
      embedding_status: 'completed',
      processed_at: new Date().toISOString(),
    },
  });
  console.log('  completed');
  return { capturedId, nodeCount, linkCount };
}

/* ---------------- 补齐缺失 embedding ---------------- */
async function fillMissingEmbeds() {
  console.log('\n== 补齐 demo scope 内 embedding 为空的节点 ==');
  const rows = await rest(`/knowledge_nodes?scope_id=eq.${DEMO_SCOPE}&select=id,name,embedding`);
  const missing = (rows || []).filter((r) => !r.embedding || (Array.isArray(r.embedding) && r.embedding.length === 0));
  console.log(`缺 embedding 节点: ${missing.length}/${(rows || []).length}`);
  let ok = 0;
  for (const n of missing) {
    try {
      await apiPost('/api/graph/embed', { node_id: n.id }, 60_000, 3);
      ok++;
      console.log(`  [${ok}/${missing.length}] embed ${n.name} (${n.id})`);
    } catch (e) {
      console.warn(`  embed ${n.name} 仍失败: ${e.message}`);
    }
    await sleep(400);
  }
  console.log(`补齐完成: ${ok}/${missing.length}`);
}

async function main() {
  console.log(`API: ${API_BASE}\nDataset: ${DATASET}${RESUME ? ' (resume)' : ''}${FILL_EMBEDS ? ' (fill-embeds)' : ''}`);
  console.log(`Supabase: ${PROJECT_ID} (demo scope ${DEMO_SCOPE})`);

  const dataset = DATASETS[DATASET];
  if (!dataset) {
    console.error(`未知数据集: ${DATASET}, 可选: ${Object.keys(DATASETS).join(', ')}`);
    process.exit(1);
  }
  const items = ONLY > 0 ? dataset.slice(0, ONLY) : dataset;
  console.log(`共 ${items.length} 条（${dataset.length} 条中的前 ${items.length}）`);

  const existingMap = RESUME ? await findExistingCaptured() : new Map();
  const results = [];
  const failures = [];
  let skipped = 0;
  // 固定并发窗口: extract 每条 8-54s, 串行 23 条约 35 分钟; 3 路并发约 12 分钟
  // 429 限流时 apiPost 自动退避, 并发窗口保持 3 可接受
  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const label = i + 1;
      try {
        const r = await seedOne(items[i], label, existingMap.get(items[i].title.trim()));
        if (r && r.skipped) skipped++;
        else results.push(r);
      } catch (e) {
        failures.push({ index: label, title: items[i].title, error: e.message });
        console.error(`  [${label}] 失败: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  console.log('\n========== 汇总 ==========');
  console.log(`成功: ${results.length}, 失败: ${failures.length}, 跳过(已 completed): ${skipped}`);
  const totalNodes = results.reduce((s, r) => s + (r.nodeCount || 0), 0);
  const totalLinks = results.reduce((s, r) => s + (r.linkCount || 0), 0);
  console.log(`抽取节点合计: ${totalNodes}, 抽取链接合计: ${totalLinks}`);
  for (const f of failures) {
    console.error(`  ✗ [${f.index}] ${f.title}: ${f.error}`);
  }

  if (FILL_EMBEDS) await fillMissingEmbeds();
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(1);
});
