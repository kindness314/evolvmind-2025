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
3. ~~30d 窗口 captured 查询 limit=50~~ → 已修复为 100（a5e6ce3）
4. O6 图谱聚焦缩放 + 懒加载仍未做（下个官方优先项）

## 有效性评估（提交 a5e6ce3，综合 98%）

`scripts/eval-effectiveness.mjs`：以 deepening 数据集为 ground truth 的客观评估，可重复运行：

| 维度 | 结果 | 判据 |
|------|------|------|
| 节点抽取 | 召回率 94% (15/16)，精确率 100% | 期望概念同义词组命中率 + 噪声节点零容忍 |
| 总结 | 5/5 信号 | 加班升温(7d up)、冥想新生(7d new)、健身降温(30d down)、叙事含因果链≥2关键词、噪声零泄漏、行动≥3条 |
| 推送 | 5/5 信号 | 语义对命中（冥想↔下午昏沉 0.691 等）、形成主题、≥2证据、nodeId 可定位、噪声零泄漏 |

评估暴露并修复的缺陷：
1. 主题方向速率归一化洗掉 30d 信号 → 改计数制（近窗≥远窗×1.5 且至少多 1 次）
2. 语义对同捕获刷屏（3 条都带"加班与睡眠因果记录"）→ 同捕获最多 1 条语义推荐
3. 语义阈值 0.70 过高（睡眠簇实测 <0.55，链式真对在 0.60-0.70）→ 降到 0.60
4. LLM 主题方向匹配歧义（"冥想与注意力训练"误配"注意力"）→ 取最早出现标签
5. 30d captured 查询 limit=50 截断窗口 → 100
6. 确定性降温信号被 LLM 主题命名淹没 → 响应新增 `themeTrends`（升温2/新生2/降温4 配额），LLM 上下文注入全部方向

## 已知限制（评估如实记录）
- 英文术语节点抽取（NER/Supabase/Tailwind 等）仍被 MiniMax 模型丢弃（prompt 强化 3 次无效）
- 睡眠语义簇（睡不着/凌晨醒）BGE-M3 相似度 <0.55，属模型 embedding 能力边界，非代码缺陷
- 评估依赖 demo scope 数据状态；清空后需重跑 `--dataset deepening` 种子

## L1 外部验证：CLUENER2020 实体切片（提交 90742db）

用清华/CLUE 权威 NER 基准（30 条采样，覆盖 name/address/scene/organization/government/position + 无实体对照）外部验证 `/api/graph/extract`：

| 指标 | 微调前 | 微调后 |
|------|--------|--------|
| 实体召回率（全类别） | 76% | **81%** |
| person/location 精确率 | 89% | **93%** |
| 可疑幻觉节点 | 5 | 3（均为 CLUENER 未标注的地名如"好莱坞/意大利"，非编造） |

权威数据暴露的真缺陷：抽取 schema 没有 organization/role 节点类型，导致 曼联/公安部/新浪房产/记者/队长 等实体被系统性丢弃 → prompt 新增两类节点规则 + 输出格式枚举更新。回归门禁（eval-effectiveness）综合 98% 无回归。

已知边界（CLUENER 测试如实反映）：
- 英文人名（Riddick/Svensson）仍丢失——MiniMax 模型拉丁词局限的又一证据
- 职位类通用词（演员）仍有漏抽；长地址被拆成多段（朝阳区/望京/南湖南路10号）——包含匹配给部分分
- 数据自动下载脚本：`node scripts/eval-cluener.mjs`（下载到 scripts/eval-data/，已 gitignore）

## L2 第二金标集 life 交叉验证（提交 c260805）

独立主题域（育儿/托班/社交/理财，与 deepening 完全不相交）验证机制泛化性：

**混合 demo scope（4 套数据集 ~150 条）实测：**
| 维度 | 结果 | 说明 |
|------|------|------|
| 抽取 | 94%/100%（另一轮 78-83%/100%） | 陌生内容上泛化优秀；轮间方差 = LLM 随机性 |
| 推送 | 80% | forming「育儿」命中、证据/nodeId/噪声全绿；设计语义对未命中（孩子睡眠簇 BGE-M3 <0.60，与 deepening 睡眠簇一致） |
| 总结 | 67% | 托班/育儿升温可见；理财/社交被主题槽位挤出（up3/new3/down4） |
| 综合 | 85% | |

**规模性发现（4 簇混合库）**：主题动态槽位（现 up3/new3/down4=10）被高计数主题占满，次级信号（理财 recent=1、社交 total=4）在计算层正确但用户不可见；推荐 top-6 槽位同样竞争。抽取不受影响。这解释了 deepening 回归 89%（life 数据加入后槽位竞争），非配额改动回归。

**纯净 scope 隔离测试（提交 9e1a61b，先备份后清空）**：
| 维度 | 混合库 | 纯净 life-only |
|------|--------|--------|
| 综合 | 85% | **87%**（另一轮 78%，LLM 方差） |
| 社交降温 | 槽位被挤，不可见 | **themes=down ✓**（LLM 主题"社交能量萎缩"） |
| forming | 育儿命中 | 育儿+托班双命中 |
| 语义对 | 设计对未命中 | 机制命中真实新对：奶睡↔深夜带娃 |

纯净测试暴露的残留问题（均如实记录）：
- LLM 命名方差：同一数据不同轮次主题命名不同（"财务系统觉醒"vs 理财标签），方向匹配尽力后仍有漏检
- 7d 窗口边界伪影：种子记录 created_at=now-7d，seed 处理延迟使其落出窗口 → 理财 total=1 被 minTotal=2 过滤（生产环境捕获永远"现在"，不踩此边界）

**数据可恢复性保证（demo-backup.mjs）**：backup/verify/wipe/restore 四模式，全量 JSON 导出（含 embedding/原始 id），恢复按原主键幂等回插，备份与恢复均数量校验。实测 144/998/1494 精确恢复，恢复后 deepening 回归 99%（基线 98%）。用法：`node scripts/demo-backup.mjs backup|verify|wipe|restore`


harness 用法：`node scripts/eval-effectiveness.mjs --dataset deepening|life`

## L3 叙事质量量化（LLM-as-judge，提交 41b2664）

`api/judge.ts` 裁判端点 + `scripts/eval-narrative.mjs`：四维评分（忠实度/洞察/可执行/结构）+ 幻觉清单，裁判输入含系统统计数据（stats/trends/themeTrends）作为可信依据。

**实测（修复前后）**：
| | 7d | 30d |
|---|---|---|
| 修复前 | 6.8 分 / 4 幻觉 | 3.5 分 / 7 幻觉（含方法学误判） |
| 修复后 | **8.0 / 0 幻觉** | **8.0 / 2 幻觉** |

修复内容：
1. 反编造规则提到 summarize prompt 顶部：只能原样引用上下文明文数字，禁止创造/改写/换算（编造的"32%/59%/飙升5倍"消失）
2. 裁判输入补系统统计数据——30d 确定性叙事的数字（100条上限等）不再被误判为幻觉
3. buildNarrative 触达 100 条查询上限时显示 "100+"（原"记录了 100 条"误导用户，实际窗口更多）

残留（如实记录）：MiniMax 仍会改写因果链术语（"心神不宁/白天废"非原文）与使用过度断言（"完全消失"）——已由裁判标注，可人工抽查。

回归门禁：综合 94%（89-99% 正常方差区间）。L1-L3 评估体系完成：
`node scripts/eval-cluener.mjs`（外部实体）/ `eval-effectiveness.mjs --dataset deepening|life`（信号）/ `eval-narrative.mjs`（叙事质量）/ `demo-backup.mjs`（数据可恢复）
