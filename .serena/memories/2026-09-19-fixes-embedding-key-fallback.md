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

## 环境备忘

- 本机 `vercel dev` 需显式 `vercel link --yes --project evolvmind-2025`（目录名大写导致自动链接报 project name 400）；已链接，`.vercel/project.json` 生成、`.env.local` 被 vercel 刷新。
