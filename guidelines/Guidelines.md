# EvolvMind — 开发指南

## 技术栈
- **Frontend**: React 18, TypeScript, Vite 6, Tailwind CSS 4, Radix UI, Motion
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Realtime)
- **API**: Vercel Serverless Functions (Node.js)
- **AI**: MiniMax-compatible LLM (chat + embedding)

## 架构约束

### 路由
- **不要使用 react-router 或 URL 路由。** App 是基于 `activeTab` 状态驱动的 SPA。
- 页面切换在 `src/app/App.tsx` 中通过 `activeTab` 条件渲染实现。
- 新增页面 = 在 `Page` 类型中加新值 + 在 `renderPage` 中加对应分支。

### API 调用
- 前端 `只` 调用本项目的 `/api/*` 服务端函数。
- **不要**直接在前端调用 LLM provider 或 Supabase 管理 API。
- `MINIMAX_API_KEY` 等凭据仅配置在服务端环境变量中。
- 不要新增 `VITE_MINIMAX_*` 变量。

### UI 组件
- 遵循 shadcn/ui 模式：Radix UI 原语 + Tailwind CSS 4 工具类。
- 基础组件放在 `src/app/components/ui/` 下，导出为可复用组件。
- 动画统一使用 `Motion`（Framer Motion）。

## 数据库
- **不要通过 Supabase Dashboard 手动修改 schema。**
- 所有 schema 变更通过 `supabase/migrations/` 下的 SQL 文件管理。
- 文件命名：`YYYYMMDDHHMMSS_description.sql`。
- 使用 `supabase db push` 应用迁移。

## 代码规范
- TypeScript Strict Mode
- 所有 API 响应和 DB 载荷定义显式 Interface/Type
- 新增 AI 提取/解析模式时，在相关库文件顶部添加 Mock Input/Output 注释块

## 安全
- 文件上传限制：`image/*`, `audio/*`, `.pdf/.doc/.docx/.txt/.md`
- 单文件最大 **10MB**（前端校验，上传前拦截）

## 开发命令
```bash
npm run dev       # 前端 Vite 开发服务器（http://127.0.0.1:5173）
npm run dev:api   # 仅启动 Vercel API（http://127.0.0.1:3000/api）
npm run dev:full  # 同时启动前端和 API
npm run build     # 生产构建检查
npm run typecheck # TypeScript 类型检查
```
