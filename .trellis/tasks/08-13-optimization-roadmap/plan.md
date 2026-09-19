# 体验优化路线图：总结社区化 / 推送融合化 / 图谱规范化

> 建立：2026-08-13
> 来源：最新技术调研（2026-08 检索确认的活跃项目）
> ⚠️ **状态：P0-P7 已全部完成（2026-08-14），评估综合 98% / 叙事 8.8 / CLUENER 84% 全过。**
> 本文件为计划留档；完成详情见 `.serena/memories/2026-08-14-optimization-roadmap-graph-visualization.md`。
> 目标：解决两个原始痛点——"总结太表面、推送不精准"——并把图谱从"LLM 自由发挥"升级为结构化

## 一、背景与现状基线

L1-L3 评估体系已建立（可复现分数）：

| 评估 | 分数 | 剩余短板（如实） |
|------|------|------|
| 抽取（deepening） | 召回 94% / 精确 100% | 英文词、近义词 embedding、**节点类型漂移**（机构打成 concept） |
| 信号机制（deepening / 纯净 life） | 98% / 87% | LLM 命名方差、槽位竞争 |
| 叙事质量（LLM-as-judge） | 8.0/10，7d 0 幻觉 | **措辞级幻觉残留**（因果链术语改写、过度断言） |

用户原始痛点（2026-08-07 记录）：总结"太表面化、排版凌乱、没有深度"；推送"太表层、不切实用"。

## 二、调研结论（技术来源，2026-08 验证活跃）

| 项目 | 证据 | 可借鉴技术 |
|------|------|-----------|
| GraphRAG（microsoft，⭐35k，持续更新） | GitHub 仓库活跃 | **Leiden 社区检测 + 层级社区摘要** → 查询聚焦总结 |
| Graphiti（getzep，⭐30k，持续更新） | README 特性 | **时态事实管理**（事实带生效窗口）、prescribed ontology、混合检索、增量构建 |
| LightRAG（HKUDS，⭐39k，EMNLP2025） | README | **双层检索**（实体级+主题级）、reranker、按角色分模型（EXTRACT/QUERY 独立配置） |
| Mem0（⭐63k，2026-04 新算法） | README | **多信号检索融合**（语义+BM25+实体并行打分）、时序推理、反馈闭环 |
| HippoRAG（arXiv 2405.14831） | 论文 | **Personalized PageRank 多跳检索**（替代朴素二跳遍历） |

## 三、优化项（三轨 P0-P7）

### 轨 A：图谱规范化（前置小改，支撑轨 B）

**P0 图谱 prescribed schema**（小，1-2h）
- 现状：抽取 kind/relation_type 由 LLM 自由发挥（L1 实测"机构打成 concept"）
- 改法：`api/graph/extract.ts` 输出后加类型校验/修正层——kind 枚举白名单（person/event/object/concept/view/conclusion/todo/question/location/organization/role/time），不合法类型降级 concept；relation_type 白名单
- 涉及：`api/graph/extract.ts`（+校验函数）
- 验收：CLUENER 上 organization 类实体 kind 正确率提升；eval-cluener 精确率不降

**P1 实体消歧合并 pass**（中）
- 现状：合并只靠 normalize_name 精确匹配（"入睡困难/睡不着/失眠"成为 3 个节点）
- 改法：抽取后对新增节点做 embedding+别名近邻消歧（相似度>0.85 且同 kind 合并），复刻 GraphRAG 的实体消歧思路
- 涉及：`api/_lib/similarity.ts` + `api/graph/extract.ts` 合并处
- 验收：deepening 睡眠簇合并后节点数下降；节点-捕获关联不丢（证据链保留）

### 轨 B：总结社区化（核心大改，直击"太表面"）

**P2 总结·社区摘要**（大，架构级 2-3 天）
- 现状：主题=标签频率，叙事=LLM 基于标签自由发挥
- 改法：GraphRAG 式三段——
  1. 在周期内的节点+边图谱上跑社区检测（Leiden 或贪心模块度，实现 ~100 行）
  2. 每社区生成一段 LLM 摘要（输入=社区节点+代表性捕获，批量并行小调用）
  3. 周期总结=社区演化综合（新增/消失/扩张/收缩社区 + 社区间新边）
- 涉及：`api/_lib/community.ts`（新）、`api/summarize.ts` 重构
- 验收：叙事能说出"你的生活出现了 3 个主题簇，X 簇在扩张（新增 4 条记录关联），Y 簇在收缩"；L3 裁判忠实度 ≥8 且幻觉 ≤1

**P3 时序分段总结**（中）
- 改法：30d 按周切 4 段，每段出确定性骨架（themeTrends 已有能力），LLM 综合成"第1周→第4周变化弧线"
- 涉及：`api/summarize.ts`（复用 computeThemeDirectionsFor）
- 验收：30d 叙事含时间推进表述；deepening 回归不降

**P4 叙事骨架润色**（中，快速缓解幻觉）
- 现状：LLM 叙事自由发挥 → L3 抓到"因果链术语改写""完全消失"类残留
- 改法：确定性骨架（themeTrends + 社区摘要 + stats）先行，LLM 只做"骨架的连贯化与证据填充"，prompt 明确"禁止引入骨架之外的新事实"
- 涉及：`api/summarize.ts` prompt + formatContextForLLM
- 验收：L3 裁判幻觉降为 0（当前 0-2）；忠实度 ≥8

### 轨 C：推送融合化（中改）

**P5 多信号融合 + 反馈权重**（中）
- 现状：规则串行（语义→图桥→形成→标签），dismissed 只做硬过滤
- 改法：候选池统一打分——每条候选算 semantic/BM25关键词/图路径 三信号加权求和；dismissed_ids 转负权重（-1.0），点击跳转=正信号（+0.5，前端回调上报）
- 涉及：`api/recommend.ts` + `src/lib/recommend.ts`（反馈上报）
- 验收：噪声/重复推荐权重下降；语义对与 forming 不再互斥；eval-effectiveness 推送信号不降

**P6 候选扩池 + rerank**（小）
- 改法：语义阈值 0.60→0.55 扩到 15 条候选，BM25 重排取 6（复用 noise/similarity 无新增依赖）
- 涉及：`api/recommend.ts`
- 验收：命中真实新对（如 奶睡↔深夜带娃 类）；评估不降

**P7 HippoRAG PPR 图桥**（中）
- 改法：`api/_lib/insights.ts` 的 findGraphBridgePaths 升级为 Personalized PageRank（以捕获 A 的节点为种子，PPR 分数排序发现强传导链）
- 涉及：`api/_lib/insights.ts` + `api/recommend.ts`
- 验收：传导链推荐命中真实因果链比例提升；耗时 <200ms

## 四、执行顺序与依赖

```
P0 (图谱schema) ──► P2 (社区摘要) ──► P3 (时序) 
   └──────────────► P4 (骨架润色，可并行于 P2 之前快速见效)
P5/P6 (推送融合) 可独立并行
P1 (消歧) 依赖 P0，独立于 P2
P7 (PPR) 依赖 P0
```

推荐顺序：**P0 → P4 → P2 → P5 → P6 → P3 → P1 → P7**
（P0/P4 小改快赢；P2 是核心；P5/P6 改善推送；P3/P1/P7 收尾）

## 五、验收标准（全部挂评估体系）

- 每项改动跑 `scripts/eval-effectiveness.mjs --dataset deepening`（回归门禁，综合 ≥94%）
- P2/P4 额外跑 `scripts/eval-narrative.mjs`（叙事质量，幻觉 ≤1）
- P0 额外跑 `scripts/eval-cluener.mjs`（外部实体，精确率不降）
- 全部完成后 `npm run typecheck` + `npm run build`
