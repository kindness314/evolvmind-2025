# App 发布待办清单（历史归档）

> 创建日期：2026-07-13
> 归档日期：2026-08-06
> 本文件内容已合并至根目录 [IMPROVEMENT.md](../../../IMPROVEMENT.md)（改进方向唯一事实来源），此处仅保留历史结论。

## 历史结论速览

| 原编号 | 事项 | 最终状态 |
|--------|------|----------|
| 1 | Embedding 服务不可用 | ✅ 已确认可用（BGE-M3, 1024 维） |
| 2 | 生产环境部署 | ✅ 已部署 https://evolvmind-2025.vercel.app (2026-07-25) |
| 2.5 | 多模态解析 | ⬜ 未实现，见 IMPROVEMENT.md 发布待办 #1 |
| 3 | 非 Demo 认证 | ✅ Email OTP A/B 隔离验收 13/13 PASS (2026-07-25)；手机号仍 BLOCKED |
| 4 | PWA 化 | ⬜ 见 IMPROVEMENT.md 发布待办 #2 |
| 5 | RLS 策略收紧 | ✅ requestScope.ts 按 Bearer 解析真实 scope，不信任 body user_id/scope_id |
| 6 | 原生壳打包 | ⬜ 见 IMPROVEMENT.md 发布待办 #3 |
| 7 | 推送通知 | ⬜ 见 IMPROVEMENT.md 发布待办 #4 |
| 8 | 性能优化 | ⬜ force-graph 懒加载归入 O6 |
| 9 | 移动端适配增强 | ⬜ 见 IMPROVEMENT.md 发布待办 #6 |
| 10 | 监控 & 崩溃收集 | ⬜ 见 IMPROVEMENT.md 发布待办 #5 |
| 11 | 聊天模型优化 | ⬜ 模型候选列表精简归入 O4 |

后续所有改进工作以 `IMPROVEMENT.md` 为准。
