# 推荐/总结深度化完成（2026-08-13）

> 承接 `2026-08-07-recommend-summarize-deepening.md`（原"待办 08-08 开工"）与 `2026-08-08-noise-filtering-continuation.md`。主体工作已完成并提交 `e49505a`。

## 完成内容

### 1. 共享洞察模块 `api/_lib/insights.ts`（新）
- 共享行类型（CapturedRow/NodeRow/LinkRow），消除 recommend/summarize 重复定义
- `computeThemeTrends` / `computeThemeDirections`：主题趋势，出现率归一化（窗口不等长可比）
- `buildGraphIndex` + `findGraphBridgePaths` + `chainText`：图谱邻接索引与二跳传导链

### 2. 推送深度化 `api/recommend.ts`
- 每条推荐带 `evidence`（引用具体捕获/节点）+ 可执行 action + 真实数据理由（时间、次数、传导链）
- review：加信号门槛（无标签且正文 <24 字 → 碎片不上桌）
- semantic：embedding 语义对（修复了批量 embedding 8s 超时导致永不触发的 bug → 并发 4 / 30s）
- graph_bridge：展示完整传导链（「冥想」→「精力」→「咖啡」）、跳过停用词链、同捕获最多 2 条桥
- forming：改为标签趋势驱动（升温/新生 + 近窗 ≥2 + 非停用词 + 来源捕获有实质内容）

### 3. 总结深度化 `api/summarize.ts`
- LLM 的 `themes[].insight` 与 `newConnections[].significance` 原先被解析器丢弃 → 现在透传
- 主题带方向（7d=本期vs上期，30d=近7天vs更早；LLM 主题名用包含匹配回查方向）
- 确定性叙事 `buildNarrative`（LLM 不可用时也是连贯叙述而非数据罗列）
- newConnections 确定性 significance（evidence 条数支撑）
- 链接任一端是噪声节点即过滤（修「加班→1.5小时」）

### 4. 图谱提取质量
- noise.ts：`第N章` 碎片节点、`睡觉` 进停用词
- extract prompt：短概念（失眠/焦虑/冥想）、章节碎片过滤；英文术语规则尝试 3 次无效（MiniMax 模型对拉丁词固有低权重，记为已知限制）

### 5. 前端
- 推荐卡证据 chips；总结区层级重设计：叙事卡 → 趋势 → 主题(方向+insight) → 重要节点 → 摘录 → 连接(意义) → 编号行动

### 6. 测试数据集 `deepening`（seed-test-data.mjs 第四套）
- 25 条：加班升温(7)、健身降温(4)、睡眠语义簇(4，无共享标签)、咖啡因/效率因果链(2)、冥想新生(2)、碎片(2)、噪声(3)

## 验证结果
- 抽取质量 30 例：0 FAIL，noise 5/5（纯噪声全空），kind 4/5，mixed 3/5；tech 类英文词缺失为模型限制
- recommend：semantic 对真实命中（加班复盘↔三周数据 75%、头痛↔三周数据 75%）、桥链可读、forming 有证据
- summarize：LLM 路径 35s 输出深度叙事 + 主题 insight + 可量化行动；429 时确定性路径 6s 兜底且方向正确
- `npm run typecheck` + `npm run build` 通过

## 环境修复（重要）
- **`.env.local` 里的 MINIMAX_API_KEY/CHAT_API_KEY 是失效的假 key（51 位但 403），遮蔽了 Vercel 远程有效 key**。已从 `.env.local` 移除（备份 `.env.local.bak-20260813`），vercel dev 现在从远程 Development 环境拉有效 key。本地直连测试用脚本需自行从远程拿 key。
- 本地 embedding 冷启动 22s，批量调用需 ≥30s 预算（已修）。

## 遗留项
1. 英文术语节点抽取（NER/Supabase/Tailwind 等）被 MiniMax 模型丢弃——prompt 已尽力，需换模型或后处理
2. 部分节点 embedding 因 qpm 限流失败（可 `node scripts/seed-test-data.mjs --dataset deepening --fill-embeds` 补）
3. 30d 窗口 captured 查询 limit=50，更早数据可能被挤出窗口，趋势"更早"计数偏小
4. O6 图谱聚焦缩放 + 懒加载仍未做（下个官方优先项）
