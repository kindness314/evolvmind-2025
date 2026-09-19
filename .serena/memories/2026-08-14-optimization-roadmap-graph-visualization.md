# 体验优化路线图 P0-P7 完成 + 图谱可视化分层改造（2026-08-14）

> 承接 `2026-08-13-recommend-summarize-deepening-done.md` 遗留项 4（体验优化路线图当前优先）。P0-P7 全部落地并通过评估门禁；随后按用户反馈把知识图谱页从"力导向毛线团"改造为**话题分层 + 下钻**式可视化。主体工作已提交（git 提交见后）。

## 一、体验优化路线图 P0-P7 全部完成

来源计划：`.trellis/tasks/08-13-optimization-roadmap/plan.md`（P0→P4→P2→P5→P6→P3→P1→P7 顺序执行）。

### P0 图谱 prescribed schema（`api/graph/extract.ts` + `src/lib/graph.ts`）
- `GraphNodeKind` 补 `organization`/`role` 枚举（此前 prompt 已输出但 TS 类型+normalizeKind 白名单缺失，LLM 输出被静默降级 concept——L1 CLUENER 暴露的系统性丢实体根因）
- 前端 `GraphNodeKind` 同步

### P4 叙事骨架润色（`api/summarize.ts`）
- `formatContextForLLM` 重构：确定性骨架先行（buildNarrative + pickThemeTrends 明细 + 社区摘要），LLM prompt 明确"只润色骨架、禁止引入骨架外新事实/数字/因果"
- prompt 增加【每周变化】时间弧线规则

### P2 总结社区化（新 `api/_lib/community.ts` + `api/summarize.ts`）
- 贪心模块度社区检测（Clauset-Newman-Moore 简化：只对有边节点、每轮只扫跨社区边、200 轮上限）——1000 节点 111ms
- 社区 LLM 摘要（并行小调用 15s 超时、失败降级确定性 describeCommunity）
- 叙事能说出"出现几个主题簇、X 簇在扩张（近窗新增 N 节点/N 条记录关联）、Y 簇在收缩"
- 响应新增 `communities` 字段（name/nodeCount/capturedCount/evolution/summary）

### P5 推送多信号融合（`api/recommend.ts` + `src/lib/recommend.ts` + `HomePage.tsx`）
- 候选池统一打分：semantic 0.4 + BM25 关键词 0.3 + 图路径 0.3 + base（`candidateScore`）
- dismissed 负权重 -1.0、点击正信号 +0.5（前端 clickedIds 上报）
- 类型配额：每类至少保最高分 1 条（语义对与 forming 不互斥）
- 新 `tokenize`/`bm25` 中文关键词信号

### P6 候选扩池 + BM25 rerank（`api/recommend.ts`）
- 语义阈值 0.60→0.55、maxPairs 15

### P3 30d 时序分段总结（`api/summarize.ts`）
- `buildWeeklyTimeline`：30d 按周切 4 段出确定性骨架，LLM 综合"第1周→第4周变化弧线"
- 响应新增 `weeklyTimeline`；judge 端点/eval-narrative 同步接收（P3 骨架此前被裁判误判幻觉，已注入可信依据）

### P1 实体消歧合并（新 `api/graph/disambiguate.ts` + `src/lib/graph.ts`）
- 服务端：已有节点 embedding + 新节点名 embedding 余弦 >0.85 且同 kind → 建议合并
- 前端 `applyGraphToSupabase`：精确匹配未命中时调用，命中则并入已有节点（aliases+source_captured_ids 保留）
- 注意：embedding 列在 PostgREST 是 JSON 数组**字符串**，需 parse 后比较；`embedding=not.is.null` 对 vector 列无效（用全量拉取前端过滤）
- `isNoiseCapture` 加"无标签且正文剥标点 ≤10 字"规则（修种子噪声"窗外有只橘猫/今天天气不错"泄漏）

### P7 PPR 图桥（`api/_lib/insights.ts` + `api/recommend.ts`）
- `personalizedPageRank`（alpha 0.85 / 15 迭代，种子=捕获A节点）+ `findPprBridgePaths`
- recommend 图桥改用 PPR 排序（graph 信号 = min(1, pprScore*5)）

### 评估门禁（全部通过）
| 门禁 | 结果 |
|------|------|
| `eval-effectiveness.mjs --dataset deepening` | **综合 98%**（抽取 94/100、总结 6/6、推送 5/5）≥94% ✅ |
| `eval-narrative.mjs` | **8.8/10**（30d 0 幻觉、7d 1 条）≤1 ✅ |
| `eval-cluener.mjs` | 召回 **84%**（↑81%）、精确率 93% 不降；新浪房产等 organization 命中 ✅ |
| `npm run typecheck` + `npm run build` | 通过 ✅ |

评估暴露并修复：种子噪声泄漏进语义推荐（noise 规则补丁）、forming 被高分语义对挤出（类型配额）、P3 每周骨架未被 judge 包含（weeklyTimeline 注入）。
**demo scope 数据已备份/清空/注入 deepening/评估/精确恢复**（169/1012/1517 校验通过），备份在 `scripts/eval-data/backups/demo-2026-08-14-full/`。

## 二、知识图谱可视化分层改造（用户驱动，多轮迭代）

### 最终形态（第四版）
**话题总览层（137 个话题大节点）→ 点击话题下钻（成员+邻居）→ 点击成员看详情**：

1. **分层聚合**：`src/lib/community.ts` 新增 `buildHierarchicalGraph`——社区检测后**边缘吸收**（社区外但有社区邻居的节点并入邻居最多的社区，671/1000 覆盖）+ **其他知识桶**（剩余杂散聚合为灰桶，弱化显示）+ **完全孤立节点收纳计数**（329 个 0 度节点不渲染）
2. **下钻交互**：`drillTopicId` state；点击话题大节点 → 局部视图（成员小节点 + 相邻话题大节点 + 内部/跨边）；点击成员 → 详情面板；面包屑「话题总览 › 话题名」+ 侧边面板返回
3. **力导向按渲染规模调优**：`forceTuning` 基于 `displayGraphData.nodes.length`（总览 137 节点时 charge -160 而非按 1000 算的 -60，节点散开防堆叠；中心聚集占比实测 10%）
4. **侧边面板重构**：移除鸡肋的 kind 分类块（与话题视图无关）；总览显示"137 个话题"列表，下钻显示话题名 + 成员类型构成 + 无关联节点数
5. **离散高区分度色板**：Tableau10 风格 20 色（色相间隔 30-170°），超数循环+明度递降；实测 27 个独特色相桶
6. **节点视觉层次**：话题节点内显示成员数大字，名称标签移到节点下方（白描边、完整可读，与侧边面板对应）；大小对数缩放 `log2(val+1)*8`（实测 max 11 vs min 1 约 3.5x 差距）

### 迭代历史（踩过的坑，避免回退）
- v1 话题卡片网格总览 → 用户不要卡片要关系网 → 弃
- v2 150 核心子集（度数 top-N）→ 用户困惑"为什么只显示150" → 弃
- v3 话题大节点 + 展开集合 + **环形强制布局（fx/fy）+ 领地半透明圆** → 用户反馈"糊在一起""奇怪的圈" → 弃（删 fx/fy 与 linkCanvasObject 领地）
- v4 当前：自然力导向 + 下钻 + 离散色 + 外部标签（用户认可"效果不错"，要求继续增强区分度与侧边对应）

## 三、遗留项
1. 英文术语节点抽取（NER/Supabase/Tailwind）仍被 MiniMax 丢弃（已知限制）
2. 部分节点 embedding 因 qpm 限流失败（`node scripts/seed-test-data.mjs --dataset deepening --fill-embeds` 可补，但脚本 --help 未识别会误跑 deep-work 数据集，需小心）
3. **headless 浏览器无法点中 canvas 节点**（坐标转换），canvas 点击下钻仅面板按钮路径在自动化中验证；真实浏览器需人工确认
4. 缩放联动层级（滚轮放大自动下钻/缩小回总览）未做——用户提及过，当前是点击驱动
5. 构建 chunk 警告 ~890KB（force-graph 未动态 import，O6 遗留）
6. PENDING.md 的 log2 非线性缩放已修（`Math.log2(fitScale+1)*0.85+1.0`），详情面板遮挡/移动端适配未验证

## 四、下次验收指引（用户将在浏览器继续验收）
- 服务：`npm run dev:full`（或 hub 起 dev-api 3000 + vite 5173）；demo 模式 `localStorage.setItem('demo_auth','true')`
- 验收点：
  1. 总览层 137 话题节点是否散开可读、颜色区分明显、节点下方标签与侧边面板对应
  2. 点话题下钻 → 成员+邻居+构成；点成员 → 详情；返回总览
  3. 推荐 action 文案个性化（语义/形成中/关联引用具体数据）
  4. 总结 7d/30d：社区簇演化、30d 时间弧线、骨架数字与统计一致
- 注意：demo scope 已恢复为评估前混合数据（169 captured），不是 deepening 纯净集

## 五、Git 状态
- 本次工作（P0-P7 + 图谱可视化）尚未提交；上次提交为 `41b2664`（L3 叙事评估）。按 AGENTS.md 仅在用户要求时推送（origin + vercel 双远程）。

## 六、图谱显示第五轮优化（2026-08-16，视觉模拟驱动）

用户反馈"继续优化图谱显示、无视觉就模拟"。用脚本量化 + headless 浏览器像素/纤维内省双通道验证（`scripts/analyze-layout.mjs`，可复现）。

### 量化发现的真实缺陷（此前用户肉眼无法说清的）
1. **总览层缩放 0.123**：力导向产出 ~2900 graph 单位 bbox，zoomToFit 后话题节点仅 4.9-5.2px，几乎空画布（nodePx 3519 vs 修复后 66440）
2. **节点重叠 190 对/137**：无碰撞力 + 旧半径公式对实际 val 分布（12-36）恒等于 38-42px，137 个话题必然叠
3. **颜色 20 组完全重复 + 1308 对近色**：20 色板循环 + 明度 clamp 到 30% 导致 87/137 唯一色
4. **标签 0 可读**：缩放 0.12 下标签阈值（fontSize*globalScale>=8）永不满足
5. 次要：`timeRange='all'` 时误显示"新增 1000 节点"；"其他知识"桶（117 成员）因 val 公式膨胀成最大节点

### 修复（KnowledgePage.tsx + community.ts）
1. **布局归一化**（handleEngineStop → normalizeAggregateLayout）：引擎停止后把节点位置缩放到画布尺度（bbox 90% 填充），zoom≈1 可读；碰撞松弛 80 轮（半径=绘制半径×1.08）在目标尺度下重解重叠；质心归零居中。guard 用 `normalizedViewRef` 防止拖拽后重归一化；**displayGraphData 变更时重置 guard**（否则下钻→返回第二次总览会跳过归一化，实测 447 重叠 → 修复后 0）
2. **半径按成员数对数缩放**（topicRadiusPx：2 成员≈13px、43≈22px，10-24 封顶；"其他知识"桶固定 10px 弱化、不显示数字）：旧 log2(val) 公式对 val 12-36 几乎恒等 38-42px
3. **金色角配色**（hue = communityId × 137.5° mod 360，明度 44/54/64 三档；"其他知识"固定 #94A3B8）：0 完全重复，中位色距 160；稳定于 communityId 不随列表顺序漂移
4. **标签贪心防重叠**：按 val 从大到小放置，与已放置标签冲突则隐藏（总览 84 个标签可读 / 53 个退化为仅数字）；按「缩放+位置」签名缓存
5. 计数文字字号随半径缩放（radius*0.55，7-16px 夹取）；"新增 N 节点"仅 timeRange≠all 显示

### 验证（全部通过）
- 脚本预测：总览 k=1.0、半径 10-21.9px、重叠 0、标签 84 可读、颜色 min 12/med 160、重复 0 组；下钻（知识图谱 43 成员）k=1.0、重叠 0
- 浏览器实测（像素分析 + React 纤维内省取真实节点坐标）：总览 136 六边形、11-19px、重叠 0、裁剪 0、k=0.82；标签与成员数文字均在渲染；canvas 点话题下钻 ✓（此前 headless 无法验证的坐标转换路径现在可测）；点成员 → 详情面板（来源记录 + 邻居与关系带证据）✓；下钻→返回循环后仍 0 重叠
- `npm run typecheck` ✓、`npm run build` ✓（chunk 警告为 O6 遗留）

### 已知限制（未做）
- 侧边面板（w-52）覆盖画布左侧 46%，其下的话题/成员不可点击（可经面板列表或关系链访问）；未做面板折叠
- 滚轮缩放自动下钻/回总览（用户早前提过）仍未做
- 137 话题下色距 min 12（金色角理论极限 ~2.6° 色相），相邻小话题仍需靠明度档区分
- 成员节点在 k=1 时 8px、内部文字 <5px 不绘制（设计如此：成员=色块，点击看详情）

### 本次改动文件
- `src/app/components/KnowledgePage.tsx`（归一化/松弛/半径/标签/计数/新增计数语义）
- `src/lib/community.ts`（金色角配色 + 其他桶灰色）
- `scripts/analyze-layout.mjs`（新增：可复现的布局质量分析器，bun 运行）
- 全部仍未提交（与上一轮 P0-P7 工作一起，等用户要求推送）

## 七、数据显示检查（2026-08-16 追加）

检查「数据」页 169 条记录（DB 实测对照）：
- ✅ 计数/排序（置顶优先+时间倒序）/时间（UTC+8 本地化）正确
- ✅ 修复 A：存量 `type='note'`（145/169，O1 前遗留类型）不在 UI 类型联合里 → DataPage/ItemDetailPage 图标空白、正文误标 `[文件]`；已修 note 与 text 同义展示（FileText 图标 + 原文直显）
- ✅ 修复 B：22 条死行（processing_status=processing、子步骤 pending、无 processed_at、创建于数周前）永远"处理中"且不可重试——旧 reconcile 只处理 graph=processing 超时；已泛化为「processing 且未完成且 3 分钟无推进 → failed」，UI 立即显示"处理失败"+重试，一键处理条显示 22 项；DB 已实测修复（147 completed + 22 failed + 0 processing）
- 验证：浏览器实测（图标/正文/徽标/一键处理条）+ DB 状态实测 + typecheck + build 全通过
- 注意：reconcileStatuses 现在返回 `{ completed, failed }` 两组 id；formatInfoRow 同步改签名

## 八、数据修复执行（2026-08-16 续）

「修复」= 实际跑通 22 条死行的处理管线（graph+embedding）。用浏览器驱动应用自带「一键处理」+ 单条重试（与用户点击完全同路径），逐行修复：

### 结果
- 147 completed + 22 failed → 151 completed + 18 failed；其中 4 条完全处理，若干条 graph 已建成（embedding 仍 pending）
- 剩余 18 条：**MiniMax QPM 429 硬墙**（本会话大量探测调用耗尽分钟配额；embedding 端点 bge-m3 正常，graph chat 持续 429）——非代码问题，配额恢复后点「一键处理」即可

### 暴露并修复的真实代码缺陷（graph 重试链）
1. **`applyGraphToSupabase` 同批同 norm 节点冲突**：LLM 对重复内容常输出同名单节点（"深度工作"+"深度工作 "），消歧无命中分支直接 INSERT → 触发 `knowledge_nodes_scope_norm_uidx`；**15/22 条批量重试因此 failed**。修复：插入前重查 normToNode（reHit 分支）+ `insertKnowledgeNodeWithFallback`（唯一键冲突 → 按同 norm 拉取已有节点合并）
2. **同对节点多条相同关系**（source::target::rel 重复）→ `knowledge_links_scope_dedupe_uidx`；修复：`insertedLinkKeys` 批内去重 + 自环跳过 + 插入冲突回退合并
3. `stringifyError` 现在带 PostgREST `details/hint`（此前只留 message，唯一冲突看不到具体键值）
4. reconcileStatuses 增加「子步骤 processing = 进行中不判死」防护（避免慢任务被误标 failed）
5. 遗留：跨次/并发重试（多次点击一键处理）共享节点时仍有极小概率冲突——已由 fallback 兜底，不再整批失败

### 验证
- 单条重试 54d74e66（注意力税）12:08 完成 ✓、8b7c7edf（米哈里）12:10 完成 ✓（修复前均 dup-key 失败）
- node fallback 生效（后续失败仅剩 link 冲突）→ link fallback 加入后 typecheck ✓、build ✓
- 剩余失败均为 429（QPM），非代码路径

### 备注
- 22 条死行含 3× 注意力残余、3× 时间块计划法等重复标题行（同内容不同行）
- 处理完成的行可能带残留 processing_error（前端 45s 超时写 failed 与服务器侧完成竞态，pre-existing，不影响状态显示）

## 九、继续排查（2026-08-16 第三轮）

### 发现并修复
1. **DataPage/ItemDetailPage `select('*')` 拉取 1.4MB**（captured_info 带 1024 维 embedding 列；169 行 select('*') 1411KB vs 裁剪列 97KB，且 DataPage 每 30s 轮询都拉）→ 改为显式列（与 KnowledgePage 列裁剪一致），轮询流量降 ~14.5 倍
2. **demo 数据 45 条重复捕获（18 组标题，25 条 content 完全一致）** —— 评估数据恢复带入的污染，是搜索重复结果（实测 DataPage 语义搜索 top8 含 3 条重复）、重试唯一键冲突、节点来源计数虚高的根因。用户确认后已清理：
   - 删 25 条完全重复行（每组保留状态最好的 1 条；测试测试 123/今天天气不错 2 组近重复为用户自测，保留）
   - 清理 99 个节点的 source_captured_ids + 15 条边的 evidence_captured_ids 中的失效引用
   - **144 条记录全部 completed**（18 条 failed 全是重复行，孪生保留行均完成）——遗留 failed 状态问题彻底消失

### 数据完整性体检（当前）
- 悬空链接 188 条（全部 ≤08-13 存量，非本次产生；图谱显示已过滤，API 社区/PPR 仅轻微噪声）
- 41/1000 节点无 embedding（语义搜索盲区，可 /api/graph/backfill 补）
- 9 条捕获无知识节点（噪声/无实体，正常）

### 验证
- 语义搜索 top8 重复 0 ✓、数据页 144 卡全部"已完成" ✓、无一键处理条（无待处理）✓
- typecheck ✓、build ✓

## 十、继续排查（2026-08-16 第四轮）

### 发现并修复
1. **图谱页静默截断**：PostgREST 默认 max_rows=1000，KnowledgePage fetch 无 limit → 1027 节点/1570 边只取回 1000（**缺 27 节点 + 570 边 36%**）。话题 141 → 全量 **171**。修复：Range 分页拉全（fetchAllPaged）。布局质量不降（171 话题 0 重叠）
2. **设置页数据统计是硬编码假数据**（342/28/156）→ 改为真实计数（145 捕获/1027 节点/1570 边）
3. **summarize 7d/30d 数字被 limit=100/200 截断**（30d 窗口实测 120 捕获/907 节点，API 报 100/100）→ fetchAllRows 分页；7d 验证数字正确（16 捕获/174 节点/184 边）
4. **recommend 图信号同样截断**（limit=2000/3000 → 1000）→ 分页拉全，graph_bridge/forming 信号用上全量图
5. 验证：捕获→摘要→图谱→embedding 全链路（新捕获"加班后决定晨跑减压"3 节点 2 关系全 completed）；图谱搜索语义/本地匹配均正常；7d 时间过滤计数与 DB 一致

### 数据体检
- 真实总量：145 捕获 / 1027 节点 / 1570 边（此前各处按 1000 计算）
- 9 条捕获无节点（噪声，正常）；41/1027 节点无 embedding（可 backfill）
- 悬空边 188（存量，显示已过滤）
- 分类过滤按钮在 v4 已移除，activeKind 逻辑为死代码（不影响显示）

### 备注
- 30d 总结响应 5-10 分钟级（LLM 叙事调用无超时，QPM 饱和时极慢）——数据聚合已快（分页），瓶颈在 LLM；非本次回归
- api/graph/disambiguate 的 limit=1000（当前 986 个已嵌入节点未触顶，>1000 时需同样分页）

## 十一、图谱总览渲染再优化（2026-08-16 第五轮，用户预览反馈）

用户预览截图反馈：①文字没在节点上很乱 ②个别节点太多/尺寸不均衡。

### 量化
- 170 话题中 50%（85 个）只有 1-2 成员；最大 81（专注度），尺寸跨度 13.5-24px（面积比 3.2x）
- 空间排布其实均匀（最近邻 29-30px，CV 0.06）——"不均衡"是**尺寸**不是位置

### 修复
1. **文字上节点**：话题名称画在六边形**内部**（白字+深描边，按内宽截断 ≤7 字），成员数放右上角**小徽标**（白圆+数字）。删除节点下方散乱标签（computeTopicLabelSig/Placement/topicLabelLayout 全部移除）
2. **尺寸压平**：topicRadiusPx = 11 + 8·log2(m+1)/log2(45)，clamp [12, 21]（旧 10-24）：3 成员 ≈14px、81 成员 ≈21px（面积比从 3.2x 降到 ~2.3x）
3. minNodes 3 试过但太激进（28 话题、专注度被吸收到 142）——回退 minNodes 2 保留粒度，只靠渲染与尺寸均衡

### 验证
- 分析器/浏览器：171 话题、zoom 0.74、**0 重叠**、0 徽标冲突、142/143 名称可读（节点内文字 + 徽标数字像素均确认渲染）
- 下钻/侧边栏正常；typecheck ✓、build ✓
- 截图：`C:/Users/public/prev-graph-final.png`
