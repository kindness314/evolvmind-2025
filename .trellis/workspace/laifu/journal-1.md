# Journal - laifu (Part 1)

> AI development session journal
> Started: 2026-07-12

---



## Session 1: Stage 1 acceptance and blocker fixes

**Date**: 2026-07-12
**Task**: Stage 1 acceptance and blocker fixes
**Branch**: `main`

### Summary

Validated the real demo knowledge-node detail flow, fixed node recommendation navigation, and secured summarize/recommend scope resolution.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Stage 1 boundary acceptance

**Date**: 2026-07-12
**Task**: Stage 1 boundary acceptance
**Branch**: `main`

### Summary

Verified recommendation navigation with controlled responses, rechecked demo scope tampering and invalid tokens, and documented remaining real-data boundaries.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Stage 1 P3-P5 acceptance

**Date**: 2026-07-12
**Task**: Stage 1 P3-P5 acceptance
**Branch**: `main`

### Summary

Verified recent summaries, recommendation empty/failure/dismiss behavior, and time-evolution filter combinations; no new source defect reproduced.

### Main Changes

## Completed

- Defined and validated Stage 1 P3-P5 acceptance criteria.
- P3: verified 7d/30d switching against real demo API responses; observed explicit no-capture summary, 30 nodes, 0 links and five important nodes. Controlled API failure rendered `总结暂不可用` without crashing Home.
- P4: natural demo response remained empty without fabricated cards. Controlled recommendation rendered and dismissed; the dismissed ID was filtered after refetch during the mounted Home session. Controlled 500 failure left Home navigation usable.
- P5: real graph time controls changed 123/123 nodes (all) to 94/123 (7d). Combining 7d with concept category produced 53/123; restoring all time with the category active produced 63/123. Mobile 390x844 controls remained visible and operable.
- No product defect was reproduced, so no source code changed.
- `npm run typecheck` and `npm run build` passed. Production build retained the known 837.80 kB chunk warning.

## Remaining external/data gaps

- Embedding requests remain blocked by `ModelNotAllowed`.
- No real authenticated non-demo user was available.
- Natural demo recommendation data remains empty.
- P3 real 7d/30d datasets currently have identical statistics, so a real temporal-boundary difference was unavailable.
- P5 search + time and focused-node cross-time context were not independently covered.


### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Stage 1 remaining boundary acceptance

**Date**: 2026-07-12
**Task**: Stage 1 remaining boundary acceptance
**Branch**: `main`

### Summary

Verified graph search/time composition and focus/time contract; P3 race reviewed in code but controlled browser interception was environment-blocked.

### Main Changes

## Completed

- Validated graph search with all/7d/30d switching using the real demo graph. Search `学生` remained usable; counts transitioned 123/123 → 94/123 → 94/123 and returned to 123/123.
- Confirmed the product's focus/time contract in `KnowledgePage.tsx`: changing the time range explicitly clears `focusedNodeId`; the graph remains usable. The filtering implementation also preserves the connected component when a center node is outside the range if focus is otherwise retained.
- Inspected P3 asynchronous period handling: each period effect owns a `cancelled` flag and cannot commit its response after cleanup. A controlled browser race could not be completed because Vite HMR repeatedly produced an empty document after request interception; this is recorded as an environment-limited check, not a runtime pass.
- No source defect was reproduced and no product source changed.
- `npm run typecheck` and `npm run build` passed. The known 837.80 kB chunk warning remains.


### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete

## Session 5: User-scope production migration and pending acceptance

### Completed

- Applied `20260713000000_secure_user_scope_and_storage.sql` to Supabase project `wocchwrvlhqdwtvfwfab`.
- Added and applied `20260713000500_restore_captured_files_bucket.sql` because the existing remote environment lacked `captured-files`; the bucket is now private.
- Verified remote migration history is up to date, anonymous real-user filtering returns no rows, Demo-scope Storage upload works, and public Storage access is disabled.
- `npm run typecheck`, `npm run build`, and Trellis context validation passed.

### Pending User Acceptance — Reminder

- User must run the real-account acceptance flow in `.trellis/tasks/07-13-user-scope-upload-security/implement.md` under `待用户执行：真实账户隔离验收`.
- Prepare two disposable phone accounts (A/B), enable Supabase Phone Auth + SMS provider, and use separate browser sessions.
- Required checks: A/B data, search, recommendations, graph, and Storage are mutually isolated; forged `user_id/scope_id` request fields cannot override the Bearer scope; upload size/type boundaries reject invalid files.
- Do not mark the security closure fully accepted until the two-account cross-isolation checks pass.
***


## Session 5: 图谱可视化 v5 + 数据显示全面排查修复

**Date**: 2026-08-16
**Task**: 图谱可视化 v5 + 数据显示全面排查修复
**Branch**: `main`

### Summary

图谱显示 5 轮迭代（归一化/碰撞/金色角/节点内文字）+ 数据显示 7 项修复（note 类型/死行/重复数据/1000 行截断/假统计等）

### Main Changes

## 图谱可视化第五轮（v5）+ 数据显示全面排查修复（2026-08-16）

无视觉环境，用脚本量化 + headless 浏览器像素/纤维内省双通道验证（`scripts/analyze-layout.mjs`，bun 可复现）。

### 图谱显示 v5（用户驱动）
- **布局归一化 + 碰撞松弛**：引擎停止后把力导向结果缩放到画布尺度（zoom≈1 可读），按绘制半径 80 轮松弛重解重叠，质心居中。guard 防拖拽后重归一化、displayGraphData 变更时重置
- **半径按成员数对数缩放**（10-24px → 12-21px 压平）：修复旧公式对实际 val 分布恒等 38-42px 的问题；巨型话题不再视觉碾压
- **金色角配色**（communityId × 137.5° mod 360 + 明度三档）：0 完全重复；"其他知识"桶固定灰 #94A3B8
- **文字上节点**（预览反馈）：名称画在六边形内部（白字+深描边、按内宽截断），成员数右上角小徽标；删除节点下方散乱标签
- 指标：171 话题、zoom 0.74、0 重叠、0 徽标冲突、142/143 名称可读

### 数据显示修复（逐步排查发现）
1. **存量 `note` 类型**（145/169 条）无图标、正文误标 `[文件]` → note 与 text 同义展示
2. **22 条死行卡"处理中"**不可重试 → reconcile 泛化（3 分钟无推进 → failed）+ 实际重跑管线（QPM 429 墙下部分完成）
3. **graph 重试链唯一键冲突**（15/22 批量重试失败）：同批同 norm 节点 + 重复关系 → 插入前重查 normToNode + 冲突回退合并（节点/边）
4. **demo 数据 45 条重复捕获**（评估污染）→ 用户确认清理 25 条完全重复 + 引用清理 → **144 条全 completed**
5. **PostgREST 1000 行静默截断**：图谱页 1027 节点/1570 边只取 1000（丢 36% 边）；summarize 30d 报 100/100（实为 120/907）；recommend 图信号截断 → 全部 Range 分页拉全
6. **设置页数据统计硬编码假数据**（342/28/156）→ 真实计数（145/1027/1570）
7. `select('*')` 拉 1.4MB embedding → 显式列裁剪（轮询流量降 14.5x）

### 验证
- `npm run typecheck` ✓、`npm run build` ✓、`git diff --check` ✓
- 捕获→摘要→图谱→embedding 全链路实测通过（新捕获 3 节点 2 关系全 completed）
- 语义搜索重复 0、图谱搜索/时间过滤/下钻/详情面板全部实测正常

### 遗留
- 18 条捕获处理失败原为 QPM 429 墙，重复行清理后已全部消失（144 全 completed）
- 41/1027 节点无 embedding（/api/graph/backfill 可补）；188 悬空边（存量，显示已过滤）
- 30d 总结响应 5-10 分钟级（叙事 LLM 无超时，QPM 饱和时慢）；侧边面板遮挡画布左 46% 下方节点不可点击；滚轮缩放下钻未做
- 全部改动未提交（等用户要求推送 origin + vercel）


### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
