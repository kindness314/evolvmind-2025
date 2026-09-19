# O6 图谱可用视口修复 + 懒加载（2026-08-18）

> 承接 `2026-08-14-optimization-roadmap-graph-visualization.md` 遗留项与 `IMPROVEMENT.md` O6 待做 1-4。O6 全部落地，仅剩滚轮缩放联动（可选项）。

## 一、修复内容

### 1. 可用视口（O6 缺陷2：详情面板打开后节点被裁切）
- **`computeUsableViewport`**（KnowledgePage.tsx 新增）：实时量取侧边面板（`sidePanelRef`）/详情面板（`detailPanelRef`）DOM rect，扣除遮挡后得到可用区域。贴边判定按**全高/全宽/普通**三态：
  - 全高面板（桌面详情右侧抽屉）：只收缩水平边
  - 全宽面板（移动端底部抽屉）：只收缩垂直边
  - 普通面板（如侧边面板 w-52，内容不足全高）：先按水平位置收缩左/右，垂直收缩仅限水平居中面板
- **坑 1**：贴边容差 EDGE=32（面板 `left-4` = 16px 距左缘，旧 GAP=12 判不中）
- **坑 2**：全高面板中心恰过画布中线（top-4 + max-h 全高 → cy≈gh/2）会被误判贴底
- **坑 3**：侧边面板内容高不足全高（296px）→ 落入普通分支被误判"贴顶"（top 收缩到 324，可用区被压掉）

### 2. 纯数学变换（关键修复）
- **坑 4（核心）**：`screen2GraphCoords` 在 d3 zoom 过渡期间与 `graph2ScreenCoords` 读到**不同步的变换**（实测 y 偏移 162px），导致"读变换→修正"链条失败（适配后图中心 y=506 而非 343.5）。
- 修复：`fitAllNodes`/`positionGraphViewport` 不再读 `screen2GraphCoords`。利用 `centerAt(p)` 使图坐标 p 居中的语义，令 `p = (画布中心 - 目标屏幕中心)/k + 图中心`，一次设置完成"图中心 → 可用区域中心"。
- 同步修复：`handleFitView`/`resetGraphView`/`drillBack` 统一走 `fitAllNodes`（原 `zoomToFit` 无可用区域意识，节点会落进侧边面板下）。

### 3. 详情面板打开时的聚焦适配
- 详情面板打开（画布被覆盖）时：聚焦分支 targetScale 改**线性 fit**（`max(0.1, min(4.0, fitScale))`，允许 zoom<1），聚焦节点完整可见于面板外；平时保持 log2 非线性曲线。
- 校准 effect 在 `nodeDetail` 开合时延长至 60 帧（覆盖 AnimatePresence 220ms 退出动画；否则关闭面板后面板 ref 未卸载，重适配读到旧 rect）。

### 4. 懒加载（O6 缺陷5：~890KB chunk）
- `App.tsx`：`React.lazy(() => import('./components/KnowledgePage'))` + Suspense fallback（居中 spinner）。force-graph 仅 KnowledgePage 引用 → 拆出主 chunk。
- 构建产物：主 chunk 682.48KB（原含 force-graph 的 ~890KB 警告）、`KnowledgePage-*.js` 226.84KB。
- keep-alive 机制下懒加载组件挂载后常驻，切换页面不重复加载。

### 5. O6 缺陷3（分类视图长标签）
- 分类视图（activeKind）无 UI 入口（按钮 v4 已移除），不可达；话题标签 v5 已画在节点内按内宽截断 —— 判定已覆盖，无代码改动。

## 二、验证（headless 浏览器 + React fiber 内省）

方法：从 root `__reactContainer$` fiber 遍历找 `KnowledgePage`，读 hook 链拿 `fgRef`（hook0），调用 `fg.zoom()`/`getGraphBbox()`/`graph2ScreenCoords()` 定量验证。

| 场景 | 桌面 1440×900 | 移动 390×844 |
|------|--------------|-------------|
| 总览 | zoom 0.321，bbox [264,420] 避开侧边面板(224)，中心 (342,344) | zoom 0.216，bbox [264,362]，中心 (313,316) |
| 下钻 | zoom 1.323，中心 (342,326) | zoom 0.831，中心 (313,298) |
| 详情面板开 | zoom 0.887（<1 线性 fit），聚焦节点在面板外 | 抽屉开 zoom 0.398，聚焦节点在抽屉上方条带 |
| 关闭恢复 | 引擎事件驱动恢复 log2（1.565） | 同 |

- typecheck ✓、build ✓（KnowledgePage chunk 227KB 独立）。
- **坑 5（验证环境）**：headless 浏览器页面 hidden → `requestAnimationFrame` 停摆 → 校准 effect（60 帧循环）不执行 → 关闭面板的自动恢复在 headless 无法验证，仅经**同步路径**（引擎事件 handleEngineStop → positionGraphViewport）验证等价逻辑；真实浏览器（可见页面）RAF 正常，需人工确认。

## 三、修改文件
- `src/app/components/KnowledgePage.tsx`：可用视口/纯数学变换/聚焦线性 fit/校准帧数/drillBack/resetGraphView/handleFitView；新增 `sidePanelRef`/`detailPanelRef`
- `src/app/App.tsx`：`React.lazy` + Suspense + fallback
- 未 commit（O3-O7 改动仍 working tree）；且 08-14 前 17 个本地提交未 push 到 origin + vercel（累计 Git 状态见 `mem:core`）

## 四、遗留（可选项）
- 滚轮缩放联动层级（放大自动下钻/缩小回总览）——用户早前提过，未做
- 侧边面板（w-52）遮挡画布左 46% 下方节点不可点击——未做面板折叠
- 下一优先：O3 signed URL 生命周期 + O7 自动化测试（见 `roadmap/dual-track-next-steps.md`）

## 五、O4 Settings 真实化 + O5 ProcessPage 删除（2026-08-18 追加）

### O4（`src/app/components/SettingsPage.tsx`）
- 用户信息卡：`supabase.auth.getUser()` 读真实 email/name/首字母头像；Demo 模式（`localStorage.demo_auth==='true'`）显示"演示账户 + 共享演示数据"琥珀标签，且不请求会话
- 模型偏好 → 模型与能力：删 GPT-4/Claude 3/Whisper 三个假下拉，改调 `/api/models` 显示服务端真实文本模型（**过滤 bge/embed**，实测 25 个）+ BAAI/bge-m3（1024 维）嵌入 + 图像识别/语音转写/文档解析"未启用"说明
- 功能设置 → 数据与隐私：删 4 个无行为假开关（消息通知/自动同步/隐私保护/深色模式），改为数据存储/AI 处理/未启用能力如实说明
- 删"存储管理 2.3 GB / 10 GB"假用量、"导出数据/帮助与反馈"无功能按钮；保留"关于 v1.0.0"+"运行环境（演示/个人）"
- 回填（批次/成功/失败/停止）2026-08-16 已实现，保留
- 验证：浏览器实测演示标注/无假下拉/无假开关（switchCount=0）/模型区与服务端一致/无假用量；非 demo 未登录显示登录页不崩；typecheck + build ✓
- **坑**：vite dev 在 HMR 期间可能缓存空模块（SettingsPage.tsx 返回 175 字节空 source）→ 重启 vite 解决

### O5（删除 `ProcessPage.tsx`）
- 静态硬编码页（产品会议要点/设计草图/客户访谈）无真实数据来源，底部导航无入口（不可达）
- 删除文件 + App.tsx 清理（import/case/Page 类型/KEEP_ALIVE_PAGES）；处理状态已由 O1 整合在首页/详情页
- 验证：grep 无残留、typecheck + build ✓

## 六、O3 signed URL 生命周期（2026-08-18 追加）

### 问题
- 上传文件的 60 分钟临时 signed URL 被存入 `captured_info.content`，过期后详情/列表不可访问

### 方案
- migration `20260818000000_add_storage_metadata.sql`（已应用正式库）：`captured_info` 加 `storage_path`/`file_name`/`mime_type`/`file_size`
- `CapturePage.tsx`（handleSave）：上传后 `content` 存文件描述文本（`文件名: x\n文件类型: y\n文件大小: z bytes`，与 analyzeAndPersist 的 contentToAnalyze 一致），`storageMeta` 四元组写入 insert；不再生成/存储 signed URL
- `ItemDetailPage.tsx`：新增 `fileUrl` state + effect（`item.storage_path` → `createSignedUrl(60*60)`，重进详情自动刷新）；photo/audio 预览用 `fileUrl ?? item.content`（旧数据回退）；正文文件行显示 `file_name`；删除优先 `item.storage_path`，旧数据回退 content URL 推导
- `DataPage.tsx`：`CAPTURED_COLUMNS` 加 4 列；`photoUrlMap`（state + ref 缓存）在 fetchData/syncData 后为 photo 行批量生成缩略图 signed URL（生成一次缓存，轮询不重复请求）；批量删除优先 `storage_path`
- 兼容：`storage_path` 为 null 的旧行走 content URL 分支

### 验证（浏览器实测）
- 上传 o3-test.png：content=描述文本、storage_path=`0000.../zwncfrmx0y_*.png`、file_name/mime_type/file_size 全有 ✓
- 详情页：img src=`/object/sign/captured-files/...`（动态 signed URL，含 token）✓
- 数据页：photo 缩略图 signed URL 显示 ✓
- 删除：DB 行删除 + storage 对象删除 ✓（demo scope 目录清空）
- 旧行兼容代码就位（demo 无存量文件行，未实测）；typecheck + build ✓

### 注意
- `supabase migration list --linked` 报 "Cannot find project ref"（环境问题），`db push --linked` 正常；以 db push 成功 + 前端实测列为准

## 七、O7 自动化测试（2026-08-18 追加）

- 引入 **Vitest 4.1.10**（`vitest.config.ts`，`npm test` = `vitest run`），`tests/` 5 文件 32 用例全通过
- `src/lib/uploadValidation.ts`（新）：上传校验纯函数（MAX_FILE_SIZE 10MiB / isSupportedFile photo=image/*、audio=audio/*、import 扩展名白名单 / isWithinFileSizeLimit），CapturePage 复用
- 用例：上传边界 5、服务端社区检测 7（贪心模块度/去重/孤立/minNodes/演化/描述）、前端分层聚合 5（buildHierarchicalGraph/边缘吸收/其他桶/金色角）、噪声 4、insights 11（时间窗/索引/二跳桥/PPR）
- **踩坑（依赖）**：`npm install -D vitest` 触发 npm 重解析，supabase-js 从 lock 的 2.101.1 漂移 → typecheck 连锁报错（PostgrestFilterBuilder 导出消失 + 泛型推断退化 unknown）。处理：
  1. 恢复 package-lock 到 HEAD（supabase-js 2.101.1）后 npm install 补 vitest 进 lock
  2. **`PostgrestFilterBuilder` import 改为定义源 `@supabase/postgrest-js`**（supabase-js 2.101.x 不再 re-export；2.95.3 也不稳）——新旧兼容的健壮修复
  3. fetchAllPaged 泛型改显式行类型 `KnowledgeNodeRow`/`KnowledgeLinkRow`（extends Record<string, unknown>，避免依赖推断）
- 教训：宽松范围依赖（`^2.95.3`）装新包会被重解析；改动后必须验证 typecheck + test + build 三者

## 八、发布门禁审查与修复（2026-08-18 追加）

### 门禁 4（LLM 端点认证）—— 已修复
- 问题：`/api/extract`、`/api/graph/extract`、`/api/judge` 匿名可调用，消耗 MINIMAX 配额
- 修复：三端点加 `resolveRequestScope`（Demo = `X-EvolvMind-Demo` 头或 body.demo；真实 = Bearer → 验证 `/auth/v1/user`；匿名 → 401）；前端 `src/lib/ai.ts`（extractInformation）与 `src/lib/graph.ts`（extractGraphViaServer）改用 `getApiAuthHeaders()`（demo 头 / Bearer）
- `api/extract.ts`/`api/graph/extract.ts` 为自声明 Vercel 类型 + 无 SUPABASE 常量，需补 `SUPABASE_URL`/`SUPABASE_ANON_KEY` 常量与 `resolveRequestScope` import
- `/api/models`：只读模型列表、无配额消耗，保留公开（审查结论可接受）
- 实测：匿名 extract/graph-extract 401、Demo header extract 200（真实 LLM）、demo body judge 通过认证（400 是业务校验）

### 门禁 5（service-role 使用）—— 审查通过
- `supabaseKey = SERVICE_ROLE || ANON`，但实际请求：有 accessToken → ANON + token（RLS 真实隔离）；仅 Demo 标识走 service-role 固定 UUID —— 这是 AGENTS.md 3.3 记载的**可审计 Demo 例外**，非普通请求无条件 fallback
- 匿名请求已被 401 拦截（resolveRequestScope throw），到不了 service-role

### 剩余发布门禁（需推送部署 / 人工）
- 门禁 3：Vercel 环境变量与 project ref 核对（推送后）
- 门禁 6：真实 A/B 复验（Email 已 13/13 PASS；手机号 BLOCKED）
- 门禁 7：生产域名各端点公网烟测（推送后）

## 九、用户验收驱动：图谱交互修复（2026-08-18 追加）

用户真实验收反馈 3 项，逐一定位根因：

### 1. 删除后不刷新（A6）
- 根因：`App.tsx` 的 `ItemDetailPage.onUpdate` 空实现；DataPage `syncData`（增量）不移除已删行
- 修复：onUpdate 派发 `evolvmind:data-changed` 事件；DataPage 事件 handler 改全量 `fetchData(false)`（增量移除不了删除）
- 验证：临时行→详情删→回列表消失 ✓

### 2. 放大后节点聚成"毛线球"（关键）
- 用户描述：蜘蛛网放大后距离极小、线乱、"疑似斥力失效"
- 数据钉死：用户大数据 bbox **4000² 一下跳到 400²**
- 根因分两层：
  a. **`normalizeAggregateLayout` 把大布局硬压到画布尺度**（`s=(画布)/(bbox)`，4000→400）——这是"自动回缩/一下跳过去"的真因；`fitAllNodes` 已用视图 zoom 适配，graph 坐标压缩是多余的
  b. charge 在 force-graph 引擎重建时可能掉回默认弱值（forceManyBody ≈-30）
- 修复：
  - `normalizeAggregateLayout` 去掉 bbox 压缩（s=1 只居中），布局保持力导向自然尺度
  - `fitAllNodes` zoom 下限 0.05→0.02（大布局能真 fit 全貌）
  - `ensureChargeStrength()` 每次渲染+引擎停止确保 -80/-160/-280
  - `autoFitRef`：适配仅在首次/下钻/筛选（displayGraphData 变化）时；`onNodeDragEnd` 置 false → 拖拽后不强制 fit 缩小
  - 曾加 fx/fy 冻结 + pauseAnimation → **导致节点拖不动、拖完回弹**，已移除（去掉 normalize 压缩后无需防收缩）
- 验证：去压缩后 demo bbox 稳定 3599×3299（不再跳变）；放大纯视图、拖拽有效、拖完不缩

### 3. 模型命名同步
- 细分的 communityId 重建 + 前端 displayGraphData 是 useMemo（不谈 topicNameMap）→ 图谱节点名不随命名更新，与左侧不同步
- 修复：`nodeCanvasObject` 话题名绘制读实时 `topicNameMap[node.communityId] || node.name`（不触发引擎重排）

## 十、图谱三层结构 + 聚类质量（2026-08-18 追加）

计划：`.trellis/tasks/08-18-graph-three-layer/plan.md`

### 数据层（已完成）
- `buildHierarchicalGraph` 三层：`superTopics`（大话题，detectCommunities 一次）→ `topics`（中话题，>25 成员递归细分，带 parentSuperId）→ 成员（nodeToTopic/nodeToSuper）
- 中话题颜色继承大话题色相（金色角）、明度错开（同爸同色系）
- `HierarchicalGraph` 接口：+superTopics +nodeToSuper；`TopicAggregate` +parentSuperId
- 33 单测通过（含大社区细分用例）

### 关键数据发现（demo 全量 1028 节点/1570 边）
- **仅 370 节点有边，658 完全孤立（64%）**；有边的聚成 170 社区最大才 4 成员
- demo 边极稀 → 话题全小碎块，"分布不准确/东零西碎"根因是**数据稀疏**非聚类算法错
- 用户真实数据（边密度高）才有大话题可细分，三层才显形

### 前端接入三层（未做，P1）
- 总览渲染大话题 → 下钻中话题 → 下钻成员；三层导航/侧边面板/onNodeClick 层级判断
- `KnowledgePage.tsx` 的 communityAnalysis/displayGraphData/drill 状态适配

### 下一步
- P1 前端两层下钻（未做）
- P2 按用户真实数据调 RECURSE_LIMIT/minNodes/合并力度；服务端 community 同步
