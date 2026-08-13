# EvolvMind 后续路线（2026-08 更新）

> 本记忆已随 2026-07-25 验收结果刷新；旧"双方向待选"协议作废——验收方向已闭合，只剩优化方向。

## 当前状态

- ✅ **Email OTP A/B 隔离验收 13/13 PASS**（2026-07-25，提交 `2fa3a2b`；`api/_lib/requestScope.ts` 隔离修复提交 `a2b4864`）。`07-13-user-scope-upload-security` 经 Email 路径关闭。
- 🔒 **手机号方向保持 BLOCKED**：Twilio Trial + 中国短信不可用，无付费升级。验收证据按 Email/Phone 分开记录，不混用。
- ✅ **O2 搜索补查已实现**：`sourcePreviews` 已恢复（`api/search.ts`、`api/graph/search.ts`），HomePage 展示匹配片段。
- ✅ **O1 捕获处理状态已完成**：migration `20260806000000_add_processing_status.sql` 已应用正式库（2026-08-06），三状态（processing/embedding/graph）链路贯通。
- ⬜ **优化方向当前优先：体验优化路线图**（总结社区化/推送融合化/图谱规范化，2026-08-13 调研制定）→ 见 `.trellis/tasks/08-13-optimization-roadmap/plan.md`；完成后回到 O6 图谱缩放+懒加载 → O4/O5 → O3/O7。

## 下次继续协议

用户说"继续"或"改进"时：

1. 读取根目录 `IMPROVEMENT.md`（改进方向的唯一事实来源；`.trellis/tasks/07-15-dual-track-roadmap/plan.md` 为历史计划，字段/步骤细节仍可参考）。
2. 输出当前优先项的前置条件、涉及文件、执行步骤、验收标准、下一步动作。
3. 不再提供"优化/验收"二选一——验收已完成，直接进入优化方向。

## 优先级排序（2026-08-13 更新）

| 顺序 | 事项 | 理由 |
|------|------|------|
| **1** | **体验优化路线图（P0-P7）** | 直击用户原始痛点"总结太表面/推送不精准"；有最新技术依据（GraphRAG 社区摘要/Graphiti 时态图谱/Mem0 多信号融合/HippoRAG PPR）；详见 `.trellis/tasks/08-13-optimization-roadmap/plan.md` |
| 2 | O6 图谱聚焦缩放 + Force Graph 懒加载 | 原第一优先，被路线图超越；PENDING.md 四缺陷已有方案；~840KB chunk |
| 3 | O4 Settings 真实化 + O5 ProcessPage | 假模型选项/静态页损害真实用户信任，改动小 |
| 4 | O3 signed URL 生命周期 + O7 自动化测试 | 文件过期不可访问；测试收口防回归 |

## 发布门禁（未变）

`npm run typecheck` + `npm run build` + LLM 端点认证/限流 + 禁止无条件 service role + 生产域名公网烟测。
