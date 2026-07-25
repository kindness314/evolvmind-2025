# App 发布待办清单

> 创建日期: 2026-07-13
> 当前状态: Stage 1 验收完成，Stage 2 未规划

---

## 阻断项（必须解决才能发布）

### 1. ~~Embedding 服务不可用~~ ✅ 已确认可用
- **根因**: `.env.local` 存有旧 API key（`sk-iLUY...`），`vercel dev` 实际从 Vercel 云端拉取环境变量（`sk-kKM3...`），所以项目里一直能用
- **修复**: `vercel env pull` 已同步正确 key 到 `.env.local`
- **验证通过**: `BAAI/bge-m3` embedding 返回 200 + 1024 维向量；`/api/search` 返回真实相似度匹配结果

### 2. 生产环境部署 ✅ 已完成 (2026-07-25)
- **前端 + API**: 已部署到 Vercel Production → https://evolvmind-2025.vercel.app
- **Supabase**: 当前使用 dev project `wocchwrvlhqdwtvfwfab`
- **域名**: 使用 Vercel 自动域名，暂未配置自定义域名


### 2.5. 多模态解析未实现
- **现状**: 图片拍照、录音、文件导入入口存在，但仅保存元数据（文件名、大小、类型），不解析实际内容
- **影响**: 用户上传 PDF/图片/音频后，系统显示"未知文本文件"，无法提取知识
- **缺口**:
  - OCR: 图片文字识别
  - ASR: 语音转文字
  - 文档解析: PDF/DOC/DOCX 正文提取
- **建议方案**: 集成第三方 OCR/ASR API（如 MiniMax 语音识别 + 文档解析），或使用开源引擎（Tesseract OCR + Whisper）
### 3. 非 Demo 认证
- **现状**: 仅 demo 模式可用（`localStorage.demo_auth === 'true'`），真实 Supabase Auth 未验证
- **需要**:
  - 打通手机号/邮箱注册登录流程
  - `resolveRequestScope` 根据真实 `user_id` 隔离数据
  - `scope_id` 从 demo fallback UUID 切换到真实用户 ID
- **验证**: 非 demo 用户可注册、登录、创建知识、查看个人图谱

---

## 强烈建议

### 4. PWA 化
- **文件**: `public/manifest.json` + Service Worker
- **效果**: 添加到主屏幕、离线启动画面、基本离线缓存
- **工具**: `vite-plugin-pwa`

### 5. RLS 策略收紧
- **现状**: demo 模式使用硬编码 fallback UUID `00000000-...`，所有 demo 用户共享数据
- **需要**:
  - 生产环境 RLS 必须基于 `auth.uid()` 隔离
  - 移除 demo fallback 路径或仅限 dev 环境
- **验证**: 用户 A 无法读取用户 B 的 captured_info / knowledge_nodes

### 6. 原生壳打包
- **iOS**: Capacitor 打包 → App Store
- **Android**: Capacitor 打包 → Google Play / 国内应用商店
- **注意**: 需要 Apple Developer Program ($99/年) 和 Google Play 开发者账号 ($25 一次性)

### 7. 推送通知
- **场景**: 复习提醒、知识更新通知
- **方案**: Firebase Cloud Messaging (FCM) + Supabase Edge Functions

---

## 可选优化

### 8. 性能优化
- **现状**: 生产构建有 838KB JS chunk（含 force-graph 库）
- **方向**:
  - `force-graph` 动态 import（`React.lazy`）
  - Tailwind CSS 按需摇树
  - 图片懒加载

### 9. 移动端适配增强
- 原生手势（滑动返回、下拉刷新）
- 原生分享（Web Share API，Capacitor 原生分享插件）
- 原生文件选择（拍照、录音、文件管理）

### 10. 监控 & 崩溃收集
- **方案**: Sentry（支持 Vercel + React）
- **覆盖**: 前端 JS 异常、API 函数异常、Supabase 查询错误

### 11. 聊天模型优化
- **现状**: `extract.ts`/`summarize.ts` 的模型列表包含已被代理拒绝的旧模型名（`abab6.5s-chat` 等 403，`gpt-3.5-turbo` 不存在）
- **建议**: 精简候选列表，优先 `MiniMax-M2.5`（已验证可用），按代理实际模型列表更新 fallback 链

---

## 里程碑建议

| 阶段 | 内容 | 预估 |
|------|------|------|
| **M1: 可部署** | #1 Embedding + #2 生产部署 + #3 认证 | 必须先完成 |
| **M2: 可分发** | #4 PWA + #5 RLS + #6 原生壳 | 可上架应用商店 |
| **M3: 可运营** | #7 推送 + #10 监控 | 可面向用户 |
| **M4: 体验优化** | #8 性能 + #9 移动端 | 优化口碑 |
