# 遗留问题集中修复（2026-09-19）

> 承接 IMPROVEMENT.md 已知问题清单，一次性修复全部代码缺陷 + 数据问题。typecheck ✓ / build ✓ / npm test 46 ✓ / 浏览器实测 ✓。

## 根因发现：Embedding 权限是 Key 问题（重要）

- `resolveApiKey`（`api/_lib/apiKey.ts`）首选 `MINIMAX_CHAT_API_KEY`，但该 key **没有** `BAAI/bge-m3` 的 `/embeddings` 权限（403 ModelNotAllowed）；`MINIMAX_API_KEY` **有**（实测 200，1024 维）。
- 修复：`api/_lib/embedding.ts` `generateEmbedding` 加 key 回退——调用方 key 优先，失败回退 `process.env.MINIMAX_API_KEY`（去重）。所有走 generateEmbedding 的端点（embed/graph embed/backfill/disambiguate 等）自动受益。
- AGENTS.md §10"Embedding Key 可能 ModelNotAllowed"约束已通过该回退解除（除非两个 key 同时失权）。

## 代码修复

| 项 | 改动 |
|---|---|
| 滚轮缩放自动下钻 | `KnowledgePage.tsx`：`onZoomEnd` + `noteProgrammaticZoom`（时间窗抑制程序化 zoom 的 end 事件）+ `wheelDrillBaseZoomRef` 基准；放大 >1.7x 且视口中心 35% 内有话题节点→下钻一层；缩小 <0.55x→回退一层；详情面板打开/成员层不钻。fitAllNodes/positionGraphViewport/handleZoomIn·Out 全部接入基准记录 |
| 侧边面板遮挡 | 09-03 已实现默认折叠（`sidePanelCollapsed`），本次仅确认，无新改动 |
| alert() → Sonner | CapturePage 4 处、DataPage 2 处、ItemDetailPage 4 处（+import toast） |
| 旧模型名清理 | `api/extract.ts` 删 abab6.5s-chat/abab6.5-chat/abab6-chat/gpt-3.5-turbo；`api/judge.ts`、`api/summarize.ts` 默认模型 abab6.5s-chat→MiniMax-M2.5、候选删 abab |
| 总结 LLM 无超时 | `api/summarize.ts` `callChatCompletion` 加 AbortController 55s（与 extract 一致），超时走既有确定性骨架降级 |

## 数据修复（demo scope，生产库）

- **无 embedding 节点 41→0**：`/api/graph/backfill` 循环跑完（key 回退生效后全部成功）
- **悬空边 188→0**：复查时已是 0（存量已被清，无需操作）
- **"其他"桶 255→39**：删除 `topic_labels` 中 name='其他' 的缓存行 → `scripts/backfill-topics.mjs` 重跑（1029/1029 分类）。之前的 255 多为旧粒度缓存/失败兜底，重分类后大多落入真实细主题（时间管理 86/专注力 69/深度工作 58…）

## 浏览器实测（headless demo）

- 总览滚轮放大 → 自动下钻「健康」；再放大 → 「运动健身」（面包屑 中话题 › 健康 › 运动健身）✓
- 滚轮缩小两级 → 健康 → 总览，逐级回退 ✓
- 侧栏默认折叠只显示「话题列表」按钮；展开显示 12 大话题计数 ✓；重分类后健康→5 细主题（睡眠 56/运动健身 23…）✓

## Git 状态澄清

- 文档旧记录"本地领先 origin 17 提交未 push"已过时：09-01 `83a01bc`（语义主题图谱+图谱驱动预测）、09-03 `8fd5f49`（自定义 Key+服务状态检测+多模态读取+向量后台化）已 commit。
- 本次提交把 08-14~09-03 遗留的 working tree 改动（HomePage 推荐依据折叠、3 个新记忆文件、08-18 任务目录、public/demo-*.html、IMPROVEMENT.md 等）与本次修复一并入库。
- **仍未 push**（等用户明确要求推 origin + vercel 双远程）。

## 数据页主题分组（2026-09-19，用户要求「数据按照主题进行整理显示」）
- `DataPage.tsx`：**两级导航**——默认只列主题（名称+最新日期+条数），点击进入该主题的记录视图（返回「全部主题」）。用户明确：降低渲染压力+更整洁。
- **分组键 = 图谱细主题（topic_labels），不是捕获 tags**（用户追问「和知识节点里的没匹配」「主题零碎又重合」）：
  - 根因：两套分类——捕获 `tags` 是抽取时 LLM 自由打的（牛年/尝试/测试…，运动/健身重合），图谱走规范细主题（~59 类）。
  - 链：`captured_info ← knowledge_nodes.source_captured_ids → topic_labels`；捕获有多节点时**主题投票**（排除「其他」，票多者胜）。
  - `loadCapturedTopics`：分页拉 topic_labels + knowledge_nodes（PostgREST 1000 行上限，`range()` 循环），构建 capturedId→topic Map；无节点/仅「其他」→「未分组」。
  - fetchData 成功后 `void loadCapturedTopics()`；映射未就绪显示「正在整理主题…」防全量卡片闪渲。
  - 原始 tags 仍保留在卡片上展示，只不再作分组键。
- 搜索（关键词/语义）保持平铺；卡片 JSX 抽 `renderItem`；状态 `activeTag`（null=主题列表）。
- 踩坑：编辑后 Vite HMR 报 "does not provide an export named 'DataPage'"（陈旧转换缓存），重启 dev server 解决。
- 浏览器验证：细主题列表（睡眠 15/专注力 16/育儿 11…）/进入/返回/未分组尾部/搜索平铺；typecheck/build/48 测试全过。

## 三项 UX 修复（2026-09-19 下午，用户反馈驱动）
1. **推荐语改推荐导向**（semantic/graph_bridge/knowledge_node/knowledge_topic）：
   价值先行，去掉「相似度 68%/标签堆砌」指标式文案。如 semantic：「你分别记过 A 和 B，却从没把它们联系起来……把这两条连起来，你就多了一条自己验证过的见解」。
2. **总结改版**（「这段时间你在忙什么」长叙事被用户嫌太长）：
   - `api/summarize.ts` 确定性+LLM 两处响应新增 `newThemes`（direction='new'）与 `newNodes`（窗口内新建节点，cap 10），sparse/empty 降级路径复用 buildDeterministicResponse 自动带上；narrative 字段保留但前端不再渲染。
   - `HomePage.tsx`：叙事卡替换为「本期新增」表格（类型/名称/备注）；「关注主题」条形图卡替换为「话题总结」分点（名称（N 条）：insight||detail）。
3. **图谱连续跳转残留修复**（用户：先后点两个话题卡，旧节点页未关+话题列表未跟随）：
   - 根因：`KnowledgePage` initialNodeId effect 只 `setDetailNodeId(null)`，未重置 drillSuperId/drillTopicId/searchQuery，keep-alive 下旧下钻状态残留。
   - 修法：effect 里全量重置（detail+两级下钻+搜索）再 focusNode。浏览器验证：下钻 健康›中话题 状态点推荐卡 → 面板回总览 12 大话题、聚焦新节点。
- 验证：typecheck/build/48 测试全过；浏览器实测总结新 UI、推荐新文案、跳转重置。

## 推荐改向：图搜索知识推荐（2026-09-19，用户验收方向变更）
- **用户反馈**：推荐目标应是「知识」（图谱节点/小主题），不是「两条记录很像」；以近期话题为种子做图搜索。
- **实现**（复用 P7 PPR 基建）：
  - `api/_lib/insights.ts` 新增 `shortestPathNames(index, fromId, targetIds, maxDepth=6)`：BFS 最短路径，返回节点名数组（**候选在前、种子在后**），不通/超深返回 null；节点查询补 `updated_at`（"最近整理是 N 天前"文案）。
  - `api/recommend.ts` 新增 Rule 0 knowledge：近 14 天捕获关联节点为种子跑 `personalizedPageRank`；排除本窗口（40 条捕获）触碰的活跃节点 + 琐碎节点 → 休眠高分节点。两类候选：
    - `knowledge_topic`：休眠节点按 `topic_labels` 细主题归组（排除「其他」，≥2 成员，top2，base 0.75），理由含成员数+代表节点+证据链，targetType `node` 指向代表节点。
    - `knowledge_node`：PPR top4 休眠节点（base 0.7），理由含关联记录数 + 最近整理时间 + 证据链。
  - 证据链文案：路径首元素是候选自身，`.slice(1)` 从下一跳起展示（「午间小睡→咖啡」而非「午间小睡→午间小睡→咖啡」）。
  - 打分接入现有 P5 统一管道（graph=PPR 归一化分，semantic/keyword=0）；`MAX_PER_TYPE=2` 保证新旧类型共存。
- **前端**：`src/lib/recommend.ts` 类型联合 + 两新类型；`HomePage.tsx` recTypeMeta + typeOrder 加「主题推荐」(amber)/「知识回顾」(violet) 置顶；点击复用已有 `targetType==='node'` → 图谱定位逻辑（零改动）。
- **验证**：48 测试全过（新增 shortestPathNames 4 断言）；demo 实测 6 条推荐含 主题「睡眠」（6 知识点，经 咖啡 与近期相连）+ 节点「精力」（43 天没碰）；浏览器确认分组渲染 + 点击跳图谱定位到「午间小睡」成员层。
- **未动**：semantic/related/review 等记录级推荐保留（用户未要求删）；LLM enrich 429 回退确定性文案。

## 环境备忘

- 本机 `vercel dev` 需显式 `vercel link --yes --project evolvmind-2025`（目录名大写导致自动链接报 project name 400）；已链接，`.vercel/project.json` 生成、`.env.local` 被 vercel 刷新。

## 追加：推荐/总结质量修复（同日第二轮，用户反馈"建议无效"）

### 诊断（真实输出驱动）
- 推荐第 1 条是"截图文件 ↔ 无法提取信息 83% 相似"——**解析失败的空壳记录穿透了噪声过滤**（有标签+元数据正文，不满足旧规则）
- 30d 总结围绕 2 条记录（其中 1 条垃圾）编出"核心枢纽/知识体系"幻觉叙事——**稀疏数据无降级**
- 推荐理由/建议全是模板套话——**enrich 只传标题不传素材 + M2.5 冷启动 11.9s > 5s 超时 → LLM 改写恒失败回退**

### 修复
- `noise.ts`：新增解析失败关键词（无法提取/未提供实际/仅包含文件名等）+ 标题模式（无法提取/截图文件/屏幕截图/IMG_/Screenshot）+ 元数据正文判定（正则匹配开头且剩余 ≤10 字，OCR 正文不误伤）+ 3 个测试用例
- `summarize.ts`：有效记录（`capturedList` 已滤噪声）<3 条 → 跳过 LLM，返回诚实"数据不足"骨架 + 记录习惯建议（顺带提速：4.2s vs 17.8s）；nextActions prompt 加证据约束（必须引用骨架真实主题）
- `recommend.ts`：enrich prompt 传入确定性理由作素材 + 明令禁止套话清单 + 超时 5s→30s（M2.5 推理型冷启动 12-30s，无更快可用模型——探测过 M3/GLM/Kimi/DeepSeek 全 403）；enrich 失败加 console.error 日志（[enrich] 前缀）；确定性 reason/action 模板按类型重写（语义对/图桥/共享标签/回顾各给具体动作）

### 数据清理（demo，用户批准）
- 删 4 条空壳捕获（2 纯元数据截图 + 2 提取失败文本）+ 派生节点 3（一键提交功能/功能缺失/这下应该可以了）+ 关联边 2 + topic_labels 缓存 + storage 对象 2；'用户' 节点剥离垃圾 source（7→6）

### 验证
- typecheck ✓ / build ✓ / npm test 48 ✓（+2 噪声用例）
- 实测：推荐无垃圾配对；建议为具体动作；30d 稀疏窗口返回诚实降级；LLM 改写质量实测优秀（"你其实在同时处理同一批压力源"），但受 provider QPM 429 限制时会回退确定性文案（日志可查）
- 待做：QPM 空闲时跑 `scripts/eval-effectiveness.mjs --dataset deepening` 回归门禁
