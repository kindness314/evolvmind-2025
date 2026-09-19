# 图谱三层结构（大话题 → 中话题 → 成员）

> 建立：2026-08-18
> 目标：把知识图谱话题从「大话题 → 成员」两层升级为「大话题 → 中话题 → 成员」三层，解决用户反馈的「话题分布不准确」（粒度不当/节点归错）。
> 承接：用户验收反馈（图谱显示/放大/拖拽已解决，剩话题分类质量）。

## 一、背景

用户验收反馈：
- 界面"专注度 81"这类大话题粒度太粗（几十个节点挤一团）
- 话题分布"根本不准确"（粒度大/小不当、个别节点归错、命名不准）
- 明确要「大话题中再做中话题分层，两层改三层」

## 二、已完成（数据层，2026-08-18）

### 1. `src/lib/community.ts` 重构 buildHierarchicalGraph 三层
- 接口：新增 `SuperTopic`（大话题：id/name/color/subTopicIds/memberCount/isOther）；
  `TopicAggregate` 加 `parentSuperId`；`HierarchicalGraph` 加 `superTopics` + `nodeToSuper`
- 第一层大话题：一次性 `detectCommunities`（贪心模块度）
- 第二层中话题：每个 >25 成员的大话题子图上递归 `detectCommunities`（minNodes 3）细分
- 节点精确归属中话题（`nodeToTopic` → 中话题 id；`nodeToSuper` → 大话题 id）
- 颜色：中话题继承所属大话题色相（金色角）、明度按序号错开（同爸同色系、不同大话题区分）
- 边缘吸收/其他桶/孤立计数保留并归到中话题层
- 33 个单测通过（含大社区细分用例）

### 2. 关键数据发现（demo 全量）
```
1028 节点 / 1570 边 → 仅 370 节点有边，658 完全孤立（64%）
有边的 370 聚成 170 社区，最大 4 成员
```
-> demo 边极稀，话题全小碎块，三层在 demo 上不明显；用户真实数据（边密度高）才有大话题可细分。

## 三、P1 前端接入三层（已完成，2026-08-19）
`src/app/components/KnowledgePage.tsx` 接入 superTopics/nodeToSuper，三层下钻链路：
- `communityAnalysis` 消费 `superTopics` + `nodeToSuper`；大话题单独命名（`superNameMap`，super id 与 topic id 独立且可能重叠的 id 空间分开存）
- 状态：新增 `drillSuperId`（与 `drillTopicId` 构成两级下钻栈）
- `displayGraphData` 三分支：总览层=大话题大节点（`isSuperTopic`）+ 跨大话题聚合边（`nodeToSuper`）；下钻1=该大话题的中话题大节点 + 内部跨中话题聚合边；下钻2=中话题成员 + 邻居中话题（沿用原逻辑）
- 导航：`drillIntoSuper`（总览→下钻1）/`drillIntoTopic`（下钻1→下钻2）/`drillBack` 逐级上溯；onNodeClick 按 `drillSuperId===null` 区分点大话题还是中话题
- 顶部三层面包屑「总览 › 大话题 › 中话题」；侧边面板按层显示大话题/中话题列表、标题计数、返回
- 节点大小统一用烘焙的 `memberCount`（super/topic 通用）；canvas 命名读实时 `superNameMap`/`topicNameMap`

### 验证（headless 浏览器，demo 数据）
- typecheck ✓、build ✓（KnowledgePage chunk 独立、未回归主 chunk 拆分）、npm test 33 ✓
- 三层链路实测：总览 171 个大话题 → 点「打断」进入下钻1（1 个中话题）→ 点中话题进入下钻2（4 个知识点）→ 面包屑逐级返回回总览
- demo 数据边稀（64% 孤立），每个大话题仅 1 个中话题（递归细分需 ≥2 个有效子社区）；三层多中话题形态需用户真实数据（边密度高）才显形

## 四、下一步

### P2 聚类质量（按用户真实数据验证后再定）
- 若用户数据大话题仍混杂/粒度不当：调 `RECURSE_LIMIT`（细分阈值）/`minNodes`/合并力度
- 孤立节点（658）占比过高时的处理策略（保留其他桶 or 提示）
- 服务端 `api/_lib/community.ts`（总结用）同步三层聚类，保持一致

### P3 验收（真实数据）
- 浏览器（真实数据）：总览大话题 → 下钻中话题 → 下钻成员，三层导航正确、颜色同爸同色系、节点不重叠
- demo（稀疏数据）：不回归 —— 已通过（171 大话题 / 单中话题 / 成员链路，见上）

## 五、涉及文件
- `src/lib/community.ts`（数据层，已完成）
- `src/app/components/KnowledgePage.tsx`（三层下钻，P1 已完成）
- `api/_lib/community.ts`（服务端聚类同步，P2，可选）
- `tests/frontend-community.test.ts`、`tests/*`（数据层测试，已完成）

## 六、语义主题总览（2026-08-19 用户验收驱动改向）

用户验收 demo 反馈"话题乱套/分布不准确"。诊断钉死根因：**demo 图结构太弱**
（916 节点巨型分量，连接稀疏），模块度/Louvain 都只能吐 2-4 碎片社区（170+ 个），
总览 171 碎片、点进去只有同规模中话题 → 乱且切换无感。

改向方案（用户选定：语义主题聚类 + 连通分量 + 图聚类增强）：

### 数据结构组织（新）
- **总览层 = 语义主题目录**（LLM 分类到 12 类：工作/健康/学习…），替代模块度碎片
- **下钻1 = 主题内图社区**（detectCommunities 细分的中话题）
- **下钻2 = 成员**
- 复用 `HierarchicalGraph` 形状（superTopics/topics/nodeToTopic/nodeToSuper），
  前端 `displayGraphData` 三层分支零改动

### 已实施
- `src/lib/community.ts`：`buildSemanticHierarchy(nodes, edges, nodeTopic)` ——
  语义主题作 superTopics，主题内图社区作 topics；3 新单测（共 9）✓
- 修 `superTopic.memberCount` 回填吸收节点 bug（原"知识联系"显示 3 实际 28）
- `api/graph/topicize.ts`：LLM 节点主题分类，**复用 topic_labels 缓存**
  （cluster_key=node_id, name=category，零新迁移）；实测首调 generated=2 写库，
  二调 generated=0 秒回
- 前端 KnowledgePage：图谱加载后调 topicize 分批分类，localStorage 镜像缓存；
  `communityAnalysis` 有分类结果即切 buildSemanticHierarchy，否则回退模块度

### 验证
- typecheck ✓、build ✓、话题单测 9 ✓
- topicize 5/5 分类合理（番茄工作法→工作、深睡→健康、辅食→家庭、React→技术）
- demo 全量回填：`scripts/backfill-topics.mjs`（后台跑，~12min，幂等）

### 遗留
- 真实用户增量分类（新节点后台 topicize 补缓存）
- 浏览器实测总览主题分布清晰度（待回填完成后）
- 服务端 summarize/community 同步语义主题（可选）

## 七、全语义两层粒度（2026-08-19 细分类，迭代第2轮）

上一版"语义宽主题 → 主题内图社区"仍有问题：图社区在主题内不可靠 → 产生
「主题—其他」乱垃圾桶（工作—其他 70、认知—其他 45…），用户嫌 80 节点无关。
且总览/下钻节点机械环排、不体现层级。

+ 改法：层级每一层都语义化，去掉图细分
- 社区：新增 `SEMANTIC_FINE_TOPICS`（细主题→宽主题映射）；`buildSemanticHierarchy`
  全语义两层：总览=宽主题(12)、下钻1=细主题、下钻2=成员。每层语义内聚，无"其他"乱堆。
- topicize：LLM 归入细主题；缓存复用 topic_labels（cluster_key=node_id）。
- 前端：nodeTopics 缓存键升 v2；语义下停用 LLM 中话题重命名。

+ 踩坑（缓存写入）
- topic_labels 唯一键 (scope_id,cluster_key)，PK 是 id(uuid)。merge-duplicates 依赖 PK
  → 对已有行 409。
- ?on_conflict=scope_id,cluster_key → UPDATE 触发 RLS 42501（该表无 update 策略）。
- 最终：先 DELETE（有策略）再 INSERT（有策略），规避 update 策略缺失。已验证落库。
- topicize 未分类节点兜底"其他"并全部写回，覆盖陈旧宽类。

## 八、完成（2026-08-19 用户验收：效果不错）

- 数据层 + 单测 ✓（36）、typecheck ✓、build ✓
- demo 1028 节点已按**细主题**全量落库（topic_labels）
- 浏览器实测：总览 12 宽主题；工作与职业 → 9 细主题（深度工作/专注力/时间管理…）；
  深度工作 → 49 相关成员；三层面包屑逐级返回
- **布局**：`src/lib/topicLayout.ts`（无外部依赖轻量力导向）按跨主题边聚类
  作为主题节点初始坐标（替代固定环排 `ringRadiusFor`）——有边关联主题聚一起、无关联散开

## 九、遗留 / 下一轮候选（供用户规划）

- "其他"仍 253/1028（不可归类节点）——可提高分类覆盖/更细目录
- 真实用户增量分类（新节点后台 topicize 补 topic_labels；示例已支持，未在真实账号验证）
- 服务端 summarize / api/_lib/community 同步语义主题（当前仅前端消费 topic_labels）
- "其他"宽主题在下钻1 内部也是散点，可考虑按原图连通/类型再分
- 布局聚类强度/尺寸随主题数再调优（topicLayout.ts 的 canvasScale/斥力参数）
- 全部改动未提交（等用户要求推送 origin + vercel）
