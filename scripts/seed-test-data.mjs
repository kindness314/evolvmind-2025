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
