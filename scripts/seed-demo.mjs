/**
 * scripts/seed-demo.mjs — 演示模式针对性种子数据(2026-10-14)
 *
 * 目标:让 /api/recommend(图桥/时间窗/同主题)与 /api/summarize(7d/30d 叙事)有可挖掘的真实结构。
 * 设计:
 *   簇1 睡眠因果链(环): 下午咖啡→入睡困难→睡眠质量差→白天犯困→午睡过长→晚间清醒→深夜刷手机→入睡困难
 *   簇2 跑步习惯: 隔天晨跑打卡(30 天 capture),节点含 晨跑/五公里配速/心率区间/跑后拉伸/膝盖酸痛/缓震跑鞋
 *   簇3 阅读: 认知觉醒/纳瓦尔宝典/卡片笔记写作法 + 摘录
 *   簇4 工作: 需求变更/代码评审/版本上线/加班(跨簇: 加班→晚间清醒, 加班→下午咖啡)
 *   簇5 育儿: 夜奶/哄睡/睡眠碎片化(跨簇桥: 夜奶→睡眠碎片化→睡眠质量差)
 * Mock Output: seed-demo.sql(节点 30 / 边 34 / 捕获 30,向量 1024 维 bge-m3,本地 edgefn 生成)
 * 写入: supabase db query --linked --file seed-demo.sql(postgres 角色,绕 RLS)。
 * 幂等: 节点 normalized_name 冲突跳过;边 source+target 存在跳过;capture 按标题+内容去重跳过。
 */
import fs from 'node:fs';

const SCOPE = '00000000-0000-0000-0000-000000000000';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const BASE = (env.MINIMAX_BASE_URL || 'https://api.edgefn.net/v1').replace(/\/$/, '');
const EMB_KEY = env.MINIMAX_API_KEY; // bge-m3 权限在 API key(2026-09-19 结论)

const nodes = [
  ['下午咖啡', 'event'], ['入睡困难', 'view'], ['睡眠质量差', 'view'], ['白天犯困', 'view'],
  ['午睡过长', 'event'], ['晚间清醒', 'view'], ['深夜刷手机', 'event'], ['蓝光暴露', 'concept'],
  ['晨跑', 'event'], ['五公里配速', 'concept'], ['心率区间', 'concept'], ['跑后拉伸', 'event'],
  ['膝盖酸痛', 'view'], ['缓震跑鞋', 'object'], ['晨跑习惯', 'concept'],
  ['认知觉醒', 'object'], ['纳瓦尔宝典', 'object'], ['卡片笔记写作法', 'object'],
  ['元认知', 'concept'], ['复利思维', 'concept'], ['渐进式总结', 'concept'],
  ['需求变更', 'event'], ['代码评审', 'event'], ['版本上线', 'event'], ['加班', 'event'], ['项目延期', 'view'],
  ['夜奶', 'event'], ['哄睡', 'event'], ['睡眠碎片化', 'view'], ['辅食添加', 'event'],
];

const links = [
  ['下午咖啡', '入睡困难', '导致'], ['深夜刷手机', '蓝光暴露', '导致'], ['蓝光暴露', '入睡困难', '导致'],
  ['入睡困难', '睡眠质量差', '导致'], ['睡眠质量差', '白天犯困', '导致'], ['白天犯困', '午睡过长', '导致'],
  ['午睡过长', '晚间清醒', '导致'], ['晚间清醒', '深夜刷手机', '导致'],
  ['晨跑', '五公里配速', '涉及'], ['晨跑', '心率区间', '涉及'], ['晨跑', '跑后拉伸', '包含'],
  ['跑后拉伸', '膝盖酸痛', '缓解'], ['缓震跑鞋', '膝盖酸痛', '缓解'], ['晨跑习惯', '晨跑', '驱动'],
  ['认知觉醒', '元认知', '涉及'], ['纳瓦尔宝典', '复利思维', '涉及'], ['卡片笔记写作法', '渐进式总结', '涉及'],
  ['元认知', '渐进式总结', '支撑'],
  ['需求变更', '项目延期', '导致'], ['项目延期', '加班', '导致'], ['代码评审', '版本上线', '支撑'],
  ['加班', '晚间清醒', '导致'], ['加班', '下午咖啡', '导致'], ['夜奶', '睡眠碎片化', '导致'],
  ['睡眠碎片化', '睡眠质量差', '导致'], ['白天犯困', '代码评审', '干扰'],
];

// [天偏移, 标题, 内容, 关键词, 摘要, 关联节点名(供 evidence)]
const now = Date.now();
const day = 86400000;
const captures = [
  [-28, '又失眠了', '昨晚 12 点躺下,1:40 还没睡着。白天下午三点喝了一杯美式,怀疑是咖啡因。', '失眠,咖啡因,入睡困难', '凌晨入睡失败,归因下午的咖啡。', ['下午咖啡', '入睡困难']],
  [-26, '白天困得不行', '中午午睡了 50 分钟,醒后头昏。昨晚实际睡眠不足 6 小时。', '犯困,午睡,睡眠不足', '睡眠不足导致白天犯困与长午睡。', ['白天犯困', '午睡过长', '睡眠质量差']],
  [-24, '深夜刷手机的循环', '躺床上刷短视频到 1 点,越刷越清醒。今天决定睡前把手机放客厅。', '深夜刷手机,蓝光,入睡困难', '识别出刷手机-清醒的恶性循环,尝试物理隔离。', ['深夜刷手机', '蓝光暴露', '晚间清醒']],
  [-20, '咖啡实验第二天', '今天只在上午 10 点前喝咖啡,晚上 11:20 入睡,比之前快。', '咖啡因,睡眠实验', '上午限咖啡后入睡时间提前。', ['下午咖啡', '入睡困难']],
  [-17, '午睡控制在 20 分钟', '设了闹钟,午睡 20 分钟,下午精神反而好。之前 50 分钟会进入深睡醒不来。', '午睡,睡眠周期', '短午睡优于长午睡。', ['午睡过长', '白天犯困']],
  [-12, '睡眠追踪两周对比', '入睡时长从 40 分钟降到 15 分钟:上午咖啡 + 睡前手机放客厅 + 固定 23:00 上床。', '睡眠改善,习惯组合', '三个习惯组合显著改善入睡。', ['入睡困难', '深夜刷手机', '下午咖啡']],
  [-5, '加班夜又破功', '版本冲刺加班到 23 点,回家刷手机到 1 点,睡眠倒退。', '加班,失眠,复发', '加班触发旧循环复发。', ['加班', '深夜刷手机', '入睡困难']],
  [-29, '晨跑 5km', '配速 6:30,心率 155,跑完很舒服。', '晨跑,五公里', '晨跑五公里,体感轻松。', ['晨跑', '五公里配速', '心率区间']],
  [-27, '晨跑 5.2km', '配速 6:22,试着最后 1km 提速。', '晨跑,配速', '配速小幅进步。', ['晨跑', '五公里配速']],
  [-25, '晨跑休息日', '膝盖有点酸,今天改拉伸和散步。', '膝盖酸痛,休息', '膝盖酸痛,主动休息。', ['膝盖酸痛', '跑后拉伸']],
  [-23, '晨跑 5km + 拉伸', '跑前动态热身,跑后拉伸 10 分钟,膝盖无不适。', '晨跑,跑后拉伸', '热身拉伸后膝盖不适消失。', ['晨跑', '跑后拉伸', '膝盖酸痛']],
  [-21, '新跑鞋开箱', '换了缓震跑鞋,落地软,脚踝压力小。', '缓震跑鞋,装备', '新缓震鞋改善落地。', ['缓震跑鞋', '膝盖酸痛']],
  [-19, '晨跑 6km', '配速 6:15,心率 152,新鞋 + 拉伸,膝盖零不适。', '晨跑,心率区间', '距离配速双提升,无伤痛。', ['晨跑', '缓震跑鞋', '心率区间']],
  [-15, '雨休两天后恢复跑', '停跑两天,今天 4km 慢跑找回状态。', '恢复跑', '雨休后恢复。', ['晨跑']],
  [-11, '晨跑 6.5km', '配速 6:05,最大心率 165 没超。膝盖稳定。', '晨跑,配速进步', '连续规律跑步第六周,指标稳步提升。', ['晨跑', '五公里配速', '心率区间']],
  [-7, '晨跑 7km', '配速 6:00,突破 7 公里。跑后拉伸认真做。', '晨跑,长距离', '距离新纪录。', ['晨跑', '跑后拉伸']],
  [-3, '本周跑步小结', '本周 3 跑共 19km,平均配速 6:05,膝盖无痛。晨跑习惯基本稳定。', '晨跑习惯,周小结', '跑量配速稳定,习惯成型。', ['晨跑习惯', '晨跑', '五公里配速']],
  [-22, '《认知觉醒》元认知笔记', '元认知是对思考的思考。每天复盘 10 分钟,观察自己的注意力去哪了。', '元认知,认知觉醒,复盘', '用元认知观察注意力分配。', ['认知觉醒', '元认知']],
  [-18, '《纳瓦尔宝典》复利摘录', '财富和知识都靠复利。每天读 1 小时,十年后是不可替代的人。', '复利思维,纳瓦尔宝典', '复利适用于知识积累。', ['纳瓦尔宝典', '复利思维']],
  [-14, '《卡片笔记写作法》实践', '开始用渐进式总结:第一遍划线,第二遍自己的话,第三遍跨书连接。', '渐进式总结,卡片笔记', '三层渐进总结法上手。', ['卡片笔记写作法', '渐进式总结']],
  [-9, '读书与跑步的联系', '晨跑后的半小时读书效率最高,身体热了脑子也清楚。把难书放在跑后读。', '晨跑,阅读效率', '发现跑步与阅读效率的联动。', ['晨跑', '认知觉醒', '元认知']],
  [-2, '本月读书清单', '读完 2 本:《认知觉醒》《纳瓦尔宝典》。在读:卡片笔记写作法。', '读书清单,月度总结', '月度阅读进度。', ['认知觉醒', '纳瓦尔宝典', '卡片笔记写作法']],
  [-16, '需求又变了', '客户端改交互,后端接口要重构,排期 +3 天。', '需求变更,排期', '需求变更导致排期延长。', ['需求变更', '项目延期']],
  [-13, '连续加班三天', '为了赶上线,加班到 22 点,下午靠咖啡撑。', '加班,版本冲刺', '冲刺期加班,咖啡续命。', ['加班', '下午咖啡']],
  [-10, '代码评审发现隐患', '评审时发现并发写问题,提前修复,避免线上事故。白天犯困时评审效率低,改到上午。', '代码评审,并发缺陷', '评审抓住并发缺陷;犯困降低评审质量。', ['代码评审', '白天犯困']],
  [-6, '版本上线成功', '凌晨发布,监控平稳。加班周结束,这周要恢复睡眠。', '版本上线,发布', '版本顺利上线。', ['版本上线', '加班']],
  [-8, '夜奶两次,睡眠碎成渣', '宝宝 1 点和 4 点各醒一次,今夜累计睡 4.5 小时。', '夜奶,睡眠碎片化', '夜奶导致睡眠碎片化。', ['夜奶', '睡眠碎片化']],
  [-4, '哄睡 40 分钟心得', '白噪音 + 拍嗝 + 固定睡眠仪式,哄睡时间从 40 分钟缩到 20。', '哄睡,睡眠仪式', '睡眠仪式缩短哄睡时长。', ['哄睡']],
  [-1, '辅食初体验', '宝宝第一次吃米粉,吃了三勺。夜醒没有明显增加。', '辅食添加,育儿', '辅食首日顺利。', ['辅食添加']],
];

async function embedBatch(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 64) {
    const chunk = texts.slice(i, i + 64);
    const r = await fetch(`${BASE}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EMB_KEY}` },
      body: JSON.stringify({ model: 'BAAI/bge-m3', input: chunk }),
    });
    if (!r.ok) throw new Error(`embed ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    if (!j.data?.length) throw new Error('embed 空返回');
    out.push(...j.data.map(d => d.embedding));
  }
  return out;
}

const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
const esc = s => s.replace(/'/g, "''");
const embLit = v => `[${v.map(x => x.toFixed(7)).join(',')}]`;

console.log('embedding 节点+捕获文本…');
const nodeTexts = nodes.map(([name]) => `${name}。`);
const capTexts = captures.map(([, t, c, kw]) => `${t}。${c} ${kw}`);
const [nodeEmbs, capEmbs] = await Promise.all([embedBatch(nodeTexts), embedBatch(capTexts)]);

const S = SCOPE;
const lines = [];
lines.push(`-- 演示模式种子(推送/总结针对性) 生成于 ${new Date().toISOString()}`);
lines.push(`insert into knowledge_nodes (id, user_id, name, normalized_name, kind, embedding, created_at, updated_at)
values ${nodes.map(([name, kind], i) =>
  `(gen_random_uuid(), '${S}'::uuid, '${esc(name)}', '${esc(norm(name))}', '${kind}', '${embLit(nodeEmbs[i])}'::vector, now() - interval '30 days', now())`
).join(',\n')}
on conflict do nothing;`);

lines.push(`insert into knowledge_links (id, user_id, source, target, relation_type, confidence, created_at)
select gen_random_uuid(), '${S}'::uuid, s.id, t.id, v.rel, 0.9, now() - interval '28 days'
from (values ${links.map(([a, b, r]) => `('${esc(a)}', '${esc(b)}', '${esc(r)}')`).join(', ')}) as v(sn, tn, rel)
join knowledge_nodes s on s.scope_id = '${S}'::uuid and s.normalized_name = lower(v.sn)
join knowledge_nodes t on t.scope_id = '${S}'::uuid and t.normalized_name = lower(v.tn)
where not exists (
  select 1 from knowledge_links l where l.scope_id = '${S}'::uuid and l.source = s.id and l.target = t.id
);`);

lines.push(`insert into captured_info (id, type, title, content, tags, summary, created_at, processed_at, processing_status, embedding_status, graph_status, embedding)
values ${captures.map(([off, title, content, kw, sum], i) => {
  const ts = new Date(now + off * day).toISOString();
  const tagsArr = `{${kw.split(',').map(t => esc(t.trim())).join(',')}}`;
  return `(gen_random_uuid(), 'text', '${esc(title)}', '${esc(content)}', '${tagsArr}', '${esc(sum)}', '${ts}', '${ts}', 'completed', 'completed', 'completed', '${embLit(capEmbs[i])}'::vector)`;
}).join(',\n')}
on conflict do nothing;`);

// capture→节点 evidence(第 6 列为节点名数组)
const evMaps = captures.map(([off, title, , , , nodeNames], i) => ({ title, nodeNames }));
for (const { title, nodeNames } of evMaps) {
  if (!nodeNames?.length) continue;
  lines.push(`update knowledge_nodes n set source_captured_ids = coalesce(n.source_captured_ids, '{}') || c.id
from captured_info c, (select id, normalized_name from knowledge_nodes where scope_id = '${S}'::uuid and normalized_name = any(array[${nodeNames.map(n => `'${esc(norm(n))}'`).join(',')}])) seed
where c.user_id is null and c.title = '${esc(title)}' and c.created_at > now() - interval '31 days'
  and n.id = seed.id
  and not (c.id = any(coalesce(n.source_captured_ids, '{}')));`);
}

fs.writeFileSync('seed-demo.sql', lines.join('\n;\n') + '\n;');
console.log(`seed-demo.sql: 节点 ${nodes.length} / 边 ${links.length} / 捕获 ${captures.length}`);
