# 已办：三项 UI/体验问题（2026-08-06 用户反馈；2026-08-07 已实施并烟测通过）

> 状态：**已实施**（2026-08-07，用户确认"计划好接着做吧"后落地）。三处改动均通过 `npm run typecheck`、`npm run build`、`git diff --check` 与浏览器 demo 模式烟测。
> 涉及文件：`src/app/components/HomePage.tsx`、`src/app/components/DataPage.tsx`、`src/app/App.tsx`。

## 问题 1：首页两模块字号偏小，内容空时更明显

首页双 tab（`HomeTab = 'recs' | 'summary'`，默认 recs）——用户反馈"首页既然没有东西了，两个模块内容就把字调大一点，调舒服一点"。

现状字号普遍偏小（HomePage.tsx 快照 3A56）：
- rec 卡片：title `text-xs`（118）、reason `text-[11px]`（120）
- 空态："暂无推荐" `text-sm text-gray-500`（137）、"暂无数据可总结" `text-sm text-gray-500`（262）
- 加载态："正在生成推荐/总结..." `text-sm`（87/145）
- summary 模块：标题 `text-sm`（94/151）、主题标签 `text-xs`（184）、重要节点 `text-xs`（197-200）、新关系 `text-xs`（212）、建议 `text-xs`（228）、stats bar `text-xs`（171-174）

调大方向：空态/加载态文案升到 `text-base` 以上且颜色更柔和；内容字号整体上调一档（text-xs → text-sm、text-[11px] → text-xs 等），保持移动端不溢出。

## 问题 2：处理中旁显示"补做"按钮多余；重试/处理完成后状态不自动刷新

DataPage.tsx 快照 80C5：

1. **"补做"按钮**：ProcessingBadge 内 `处理中` 文案（77 行）旁边，`showAction &&` 时渲染"补做"按钮（78-86）。showAction 判定与 `isActionable`（119-132）同源：`anyProcessing && (graphActionable || embedActionable)`（130）→ 处理中的项只要还有子步骤可做就显示"补做"。用户要求：**处理中旁边不显示补做**（正在跑就不该有补做入口）。修复方向：showAction 排除 processing 中状态，或仅失败/待处理时显示。

2. **状态不自动刷新**：用户反馈"重试或者处理完之后没有刷新状态，总是要我手动刷新"。现有链路：`handleRetry` 完成时 `.then(() => fetchData())`（209-210）；`handleRetryAll` 结束后 `await fetchData()`（241）；30s 静默轮询（156-164）已加但用户未感知或不够。候选根因：
   - 重试执行耗时 45-60s（含 8s 项间限速），期间卡片仍显示旧状态（failed/处理中），完成瞬间才 fetchData——体验上像"没反应"；
   - 重试中状态未置为 processing（UI 无进行中反馈）；
   - fetchData 15s 超时或网络抖动失败时（轮询失败不覆盖列表、手动失败显示错误页）列表保持旧状态。
   需排查：重试开始时应立即把该项 UI 置为"处理中"，完成后保证一次可靠刷新（失败也提示），可选轮询间隔缩短或重试完成后强制重取。

## 问题 3：切换界面每次重新加载，加载慢

App.tsx 用 `activeTab` 状态条件渲染页面 → 每次切 tab 页面组件 **unmount/mount**，重新请求：DataPage fetchData（supabase REST 直连，实测 4.2s+，中国网络常态慢）、HomePage fetchSummary + fetchRecommendations、KnowledgePage 图谱数据等。用户反馈"每切到一个界面就需要重新加载，太影响体验，加载速度也比较慢，想办法提速"。

提速候选方向（未定方案）：
- **保留组件而非卸载**：切 tab 用 CSS `display:none` 隐藏（keep-alive 模式），数据缓存于内存，返回即现；
- **状态提升/全局 store**：数据提升到 App 层或轻量 store（如 module-level cache + 失效策略），避免重复请求；
- **请求提速**：supabase 响应层缓存/本地代理、分页加载（数据页目前全量 select('*')）、REST 只取展示所需列；
- 权衡：内存占用 vs 体验；数据新鲜度（处理状态变化）需要合理失效策略（如 30s 轮询已存在）。

## 备注

- 问题 1-3 的具体改动与验证记录见文末「实施记录（2026-08-07）」。
- 相关既有能力：DataPage 已有 30s 静默轮询 + 15s 超时 + stale 修复（快照 80C5）；keep-alive 实现未重复添加轮询机制。

## 实施记录（2026-08-07）

- **问题 1（首页字号）**：HomePage 内容字号整体上调一档——rec 卡片 title `text-xs→text-sm`、reason `text-[11px]→text-xs`、区块头"为你推荐"`text-sm→text-base`；summary 模块标题/统计/主题/节点/关系/建议 `text-xs→text-sm`（`text-[11px]→text-xs`）；空态/加载态 `text-sm→text-base` 且颜色改 `text-gray-400` 更柔和。保留 truncate 防移动端溢出；tab 栏与周期控件尺寸不动。
- **问题 2（补做按钮 + 状态刷新）**：`ProcessingBadge.showAction` 与 `isActionable` 移除 `anyProcessing && (graphActionable || embedActionable)` 分支 → 处理中不再显示"补做"、一键处理不再计入处理中项；`handleRetry`/`handleRetryAll` 开始即乐观置为"处理中"（本地 setData，含子状态清错），失败用 `toast.error` 替代 `alert`，`finally` 中 `fetchData()` 收敛刷新。
- **问题 3（切 tab 重载）**：App.tsx 由 AnimatePresence 卸载/挂载改为 keep-alive——`visitedPages` 记录已访问页面（初始 `{'home'}`），首次访问挂载后常驻，切换仅 opacity 淡入 + `visibility:hidden`，不再重新请求；DataPage 30s 轮询继续保证新鲜度；HomePage 新增 `active` prop，从其他页切回时静默刷新推荐/总结（不闪 loading）。滑动动画降级为淡入。
- **验证**：typecheck ✓ / build ✓（chunk 警告为非失败项）/ git diff --check ✓；浏览器 demo 模式烟测——首页字号实测（rec title 14px、reason 12px、summary header 16px、统计/章节标题 14px）✓；数据页切回首页 300ms 内直接显示旧内容、无 loading 闪烁 ✓；无 console 报错 ✓。
- working tree 改动未 commit；已 commit 代码（`a2b4864` 及之前）已推送 origin + vercel（2026-08-07）。
