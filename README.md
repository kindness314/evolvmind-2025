
## EvolvMind

一个用于“捕获碎片信息 → AI 抽取结构 → 构建个人知识图谱”的前端应用（Vite + React），并使用 Supabase 作为数据与文件存储。

### 本地运行

- 安装依赖：`npm i`
- 启动开发：`npm run dev`

### 部署与配置

部署到 Vercel + Supabase 后，知识图谱构建所需的两件事：
- Supabase 应用数据库迁移（包含图谱表结构扩展）
- Vercel 配置服务端环境变量（用于 /api/graph/extract 调用 LLM）

详见：[DEPLOYMENT.md](file:///d:/evolvmind-2025/EvolvMind/DEPLOYMENT.md)
  
