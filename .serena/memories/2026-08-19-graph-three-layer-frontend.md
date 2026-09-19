# ⚠️ 当前状态（2026-08-19 用户验收：效果不错）——标注，避免读错

图谱分层**最终采用方案：语义主题两层粒度**：
`总览(12 宽主题) → 下钻1(细主题, LLM 分类 ~59 项) → 下钻2(成员)`。
由 `buildSemanticHierarchy(SEMANTIC_FINE_TOPICS)` 全语义驱动，**不依赖图结构**。
本文件下方"P1 三层模块度""宽主题→主题内图社区"均为**历史版本，已被本方案取代**，
仅留档。demo 1028 节点已按细主题落库(topic_labels)，浏览器总览 12 大话题、
工作→9 细主题、深度工作→49 成员，均已验收。
typecheck / build / npm test(36) 全绿。改动**未 commit**（本文件全部改动 + 08-16~08-18 的 v5/O3-O7 都仍在 working tree；且 08-14 前 17 个本地提交也未 push 到 origin/vercel——见 `mem:core` Git 状态）。

---

 # 图谱三层前端接入（P1 完成，2026-08-19）

> 承接 `.trellis/tasks/08-18-graph-three-layer/plan.md` P1；数据层（buildHierarchicalGraph 三层）08-18 已完成。

## 改动（仅 `src/app/components/KnowledgePage.tsx`）
- `communityAnalysis` 消费 `superTopics` + `nodeToSuper`（原先只消费 `topics`）
- 新增 `drillSuperId` 状态（与 `drillTopicId` 组成两级下钻栈）；`displayGraphData` 三分支：
  - 总览层（drillSuperId===null）：大话题大节点（`isSuperTopic:true`）+ 跨大话题聚合边（`nodeToSuper`）
  - 下钻1：该大话题的中话题大节点 + 内部跨中话题聚合边（`parentSuperId` 过滤）
  - 下钻2：中话题成员 + 邻居中话题（沿用原逻辑）
- 导航：`drillIntoSuper` / `drillIntoTopic` / `drillBack`（逐级上溯：topic→super→总览）；onNodeClick 按 `drillSuperId===null` 区分
- 顶部三层面包屑「总览 › 大话题 › 中话题」；侧边面板按层显示大话题/中话题列表、标题计数、返回
- 大话题单独命名 `superNameMap`（**super id 与 topic id 各占独立且可能重叠的 id 空间，分开存**，不能共用一个 map）
- 节点大小统一用烘焙 `memberCount`（super/topic 通用）；canvas 命名读实时 `superNameMap`/`topicNameMap`
- GraphNode 新增 `isSuperTopic?`；`resetGraphView`/`handleCategorySelect`/`hasFilteredView`/normalize key 都补 `drillSuperId`

## 踩坑
- 重写聚合分支时把 `aggNodes/aggLinks/pushAggLink` 声明块一起删了 → 连环 TS2304；需保留在分支外。

## 验证
- typecheck ✓、build ✓（KnowledgePage chunk 独立、主 chunk 拆分未回归）、npm test 33 ✓
- headless 浏览器（demo）：总览 171 个大话题 → 点「打断」下钻1（1 个中话题）→ 点中话题下钻2（4 个知识点）→ 面包屑逐级返回
- demo 数据边稀（64% 孤立），每个大话题仅 1 个中话题（递归细分需 ≥2 个有效子社区）；三层多中话题形态需用户真实数据（边密度高）才显形

## 遗留
- P2 聚类质量（RECURSE_LIMIT/minNodes/服务端 community 同步）待用户真实数据
- 全部改动未提交（等用户要求推送 origin + vercel）

# 图谱显示改向：语义主题总览（2026-08-19 用户验收反馈后）

## 根因（诊断钉死）
- demo 图结构太弱：916 节点巨型分量，连接稀疏 → 模块度/Louvain 只吐 2-4 碎片社区
  （170+ 个），总览 171"大话题"全是单点名（橘猫/带饭），点进去只有同规模中话题 → 乱且切换无感
- `superTopic.memberCount` 不回填吸收节点（bug）：如"知识联系"显示 3、实际 28

## 方案（用户选定：语义主题聚类 + 连通分量 + 图聚类增强）
**数据结构：总览 = LLM 语义主题目录(12类) → 下钻1 = 主题内图社区 → 下钻2 = 成员**
复用 `HierarchicalGraph` 形状 → 前端 `displayGraphData` 三层分支零改动。

## 已实施
- `src/lib/community.ts`：`buildSemanticHierarchy(nodes,edges,nodeTopic)` + 修 memberCount 回填 + 3 单测
- `api/graph/topicize.ts`：LLM 节点主题分类；**复用 topic_labels 缓存**
  （cluster_key=node_id, name=category，零新迁移，其 RLS 已覆盖 demo/own scope）；
  实测首调 generated=2 写库、二调 generated=0 秒回
- `src/lib/nodeTopics.ts`：localStorage 镜像缓存
- KnowledgePage：加载后分批调 topicize（200/批）→ 有分类即切 buildSemanticHierarchy；
  demo 全量已回填 topic_labels（scripts/backfill-topics.mjs，batch=60+重试，因 200/批易被 LLM 限流/解析失败）

## 关键坑
- **语义 super/topic id（0..N）与旧模块度残留 superNameMap/topicNameMap 的 id 冲突**
  → "财务与理财/社交与人际"被旧名"知识关联/番茄工作法"覆盖。修：切语义时清空两 map +
  superDisplayName 在语义下直接用目录名（不查 superNameMap）
- topicize 大批次(200)易被 MINIMAX 限流/解析失败 → 回填用 batch=60 + 重试
- LLM 分类 200 节点/批约 2 分钟；batch=60 约 15-35s → demo 全量一次性约 12min

## 验证（浏览器实测）
- 总览 = **12 个语义主题**（学习/工作/健康/家庭/生活/技术/财务/社交/心理/认知/兴趣/其他），不再碎片
- 工作与职业 → 20 个中话题（深度工作块/番茄工作法/效率/加班…）→ 番茄工作法 → 24 成员+类型构成
- 三层面包屑「总览 › 工作与职业 › 番茄工作法」逐级返回 ✓
- typecheck ✓ / build ✓ / npm test 36 ✓

## 遗留
- "其他"桶仍占 189/1028（不可归类节点）；可后续提高分类覆盖
- 真实用户增量分类（新节点后台 topicize 补缓存）
- 服务端 summarize/community 同步语义主题（可选）
- 全部改动未提交（等用户要求推送 origin + vercel）

## 迭代2：全语义两层粒度（2026-08-19，细分类完成）

上一版"语义宽主题 → 主题内图社区"仍乱：图社区在主题内不可靠 → 「主题—其他」垃圾桶
（工作—其他 70、认知—其他 45…），用户嫌 80 节点无关。

### 终版结构（每层语义内聚，去图细分）
- `community.ts` `SEMANTIC_FINE_TOPICS`（细→宽映射 ~59 项）+ `buildSemanticHierarchy`
  全语义两层：总览=宽主题(12) → 下钻1=细主题 → 下钻2=成员。无"其他"堆。
- 浏览器实测：总览 12 宽主题；工作与职业 → 9 细主题（深度工作/专注力/时间管理…）；
  深度工作 → 49 相关成员。36 测试 ✓、build ✓。

### 踩坑（topic_labels 缓存写）
- 该表唯一键 (scope_id,cluster_key) 但 PK=id(uuid) → PostgREST merge-duplicates 对已有行 409。
- `?on_conflict=scope_id,cluster_key` → UPDATE 触发 RLS **42501**（该表无 update 策略）。
- 终解：**先 DELETE（有策略）再 INSERT（有策略）**。已验证 8 节点落库 7 时间管理+1 其他。
- topicize 未分类节点兜底"其他"并全部写回，覆盖粒度升级前陈旧宽类。

### 遗留
- 布局：用户嫌"没严格按层级排布、像按顺序"（环排）—— 待确认期望的层级排布形态。
- "其他"仍 253/1028（不可归类节点）。
- 全部改动未提交（等用户要求推送 origin + vercel）。

### 布局：同一层按关联度聚类（已实施）
- 用户嫌"没严格按层级排布、像按顺序"（固定环排）。选定"同一层内按关联度聚类排布"。
- `src/lib/topicLayout.ts`（无外部依赖的轻量力导向：斥力+弹簧+居心）对聚合图
  （主题节点+跨主题边）离线算聚类坐标，作为 displayGraphData 总览/下钻1 主题节点的
  初始位置（替代 ringRadiusFor 环种子）。
- `KnowledgePage.tsx` displayGraphData 聚合返回前 `clusteredTopicLayout(...)` 设 x/y。
- 有边关联的主题聚在一起、无关联散开；父子层级仍由面包屑+侧栏体现。
- typecheck ✓ / build ✓ / 浏览器总览 12 大话题渲染 ✓。
