# EvolvMind conventions

- Use explicit TypeScript interfaces/types for API responses and DB payloads; strict type safety is the project direction.
- Keep navigation state in `App.tsx`/`activeTab`; do not introduce URL routing.
- UI uses reusable Radix/shadcn-style primitives under `src/app/components/ui/`, Tailwind utilities, and Motion for transitions/micro-interactions. Avoid inline styles except computed dynamic values.
- **UI 视觉令牌（主题层，`src/styles/theme.css`）**：页面统一用设计令牌而非硬编码色/圆角。品牌色用 `--color-brand`（iOS 系蓝，`bg-brand`/`text-brand`/`border-brand`）、`brand-strong`/`brand-soft`/`brand-muted`；语义色用 `success`/`warning`/`danger`/`ai`（各含 `*-soft` 浅底）；卡片阴影用 `shadow-card`/`shadow-float`。圆角用 Tailwind `rounded-lg`/`rounded-xl`/`rounded-full`，**禁用内联 `style={{ borderRadius: '4px' }}`**（2026 视觉改版已把各页面的 4px 直角统一掉）。
- All user-scoped API handlers resolve scope from `api/_lib/requestScope.ts`: Demo is explicit fixed scope; non-Demo requires Bearer token resolved through Supabase Auth. Continue the same Authorization token for user-scoped follow-up queries; do not substitute service-role identity.
- Captured file validation must happen on selection and again immediately before upload/save; reject >10 MiB and unsupported MIME/extension, clear input/preview on failure, and do not call Storage upload. Non-text files retain metadata only unless OCR/ASR is actually implemented; tell users that parsing is pending.
- AI JSON handling must tolerate `<think>` tags/markdown fences and repair/extract JSON from the response tail; failed repair falls back to `Unstructured` plus visible Sonner notification without dropping raw data.
- New DB security changes use timestamped migrations under `supabase/migrations/`; preserve auditable Demo exception and auth.uid()-based real-user policies.
## 环境与工具备忘(2026-10-14)
- Supabase CLI(Windows): 平台二进制包名 `@supabase/cli-windows-x64`;npx 缓存会被并发跑坏(症状:No matching binary / Invalid Version / 明明存在的版本 ETARGET),修复=`npm cache clean --force` + `npx -y supabase@2.121.0`;并发跑多个实例会再跑坏,串行用。
- git-bash taskkill 用单斜杠 `taskkill /F /PID <pid>`(双斜杠报无效参数);`npm run dev:api` 端口被占静默退出(日志 0 字节=没起来),按 `netstat -ano | findstr :3000` 找 PID。
- vercel dev 会合并云端 Development env 与 .env.local:CHAT key 若云端只配 Production/Preview,dev 拿到本地旧 key+云端新 base_url → 401。本地调 AI 链路直接打生产或先 `vercel env pull`。
- GitHub 断连应急: `gh api -X PUT /repos/<r>/contents/<path>` 逐文件提交;大文件先 `base64 -w 0` 再 `-F content=@file`(相对路径);恢复后 `git pull --rebase` 理顺双线历史。
