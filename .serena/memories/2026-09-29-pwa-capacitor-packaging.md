# PWA + Android 原生壳打包(2026-09-29)

用户选定路线:**PWA + Capacitor Android 壳**(不含桌面、不含 iOS)。

## PWA(已完成并验证)
- `vite-plugin-pwa`(autoUpdate):预缓存 14 个静态资源(1.08MB);`/api/*` 与 `*.supabase.co/*` 强制 NetworkOnly,不缓存数据/写操作;navigateFallbackDenylist 排除 /api。
- manifest:中文名「EvolvMind 进化心智」、theme `#0a84ff`、standalone、竖屏、3 图标(192/512/maskable)。
- `index.html`:lang zh-CN、viewport-fit=cover、apple-touch-icon、apple-mobile-web-app-*。
- 图标:`scripts/generate-icons.mjs`(sharp 栅格化 SVG,品牌蓝渐变+知识网络节点图形)产出 `public/icons/`。
- 移动适配:`App.tsx` 外壳 `h-screen`→`h-dvh`、顶部 `pt-[env(safe-area-inset-top)]`、底导航 `pb-[env(safe-area-inset-bottom)]`。
- 验证:`npm run preview` + 浏览器实测——manifest 可达、SW active、390×844 渲染正常。tsc/build/52 测试全过。

## Capacitor Android(工程就绪,本机无 SDK 无法出 APK)
- `capacitor.config.ts`:appId `com.evolvmind.app`,**server.url 指向 https://evolvmind-2025.vercel.app**(WebView 加载线上站,前端永远最新;若改离线打包需把 API 调用改绝对地址)。
- `npx cap add android` 已生成 `android/` 工程;`scripts/generate-android-icons.mjs` 生成 mdpi~xxxhdpi 启动图标+自适应前景;`ic_launcher_background` 改为品牌蓝 #0a84ff(默认白色会吞掉白色图标)。
- package.json 新脚本:`icons` / `cap:sync` / `apk`(需本机 SDK) / `android`(需 Android Studio)。
- **出 APK 两条路**:
  1. GitHub Actions:`.github/workflows/android-apk.yml`(workflow_dispatch,setup-java 17 + setup-android,产出 debug APK artifact)——推送后 Actions 页手动跑。
  2. 本机:装 Android Studio(SDK+command line tools)后 `npm run apk`。
- iOS:需 Mac + Apple 开发者账号,未做。

## 注意
- 语音识别 `webkitSpeechRecognition` 在 Capacitor WebView 中不存在,CapturePage 已有 `speechSupported` 降级,无需改。
- Email OTP 是验证码输入式,无 OAuth 重定向,WebView 内可直接用。
- Supabase session 存 localStorage,WebView 内持久化正常。
- android/ 自带 .gitignore(build/、.gradle 等不会入库)。

## 追记:生产部署修复(2026-09-29 深夜)
- **根因**: Vercel Hobby 单部署 12 函数上限,09-03 起 17 个 API 文件 -> 部署全 ERROR,线上停在 8 月旧版(errorCode=exceeded_serverless_functions_per_deployment,部署阶段才炸,构建日志无提示)。
- **修复**: api/graph/{embed,backfill,search,topicize,classify-topics,disambiguate} 6 函数移到 `api/_lib/graphOps/`,新增 `api/graph-ops.ts` 静态分发器 + vercel.json 显式重写(URL 不变)。函数 17->12,部署 READY,生产已是 2622cc8。
- **坑**: Vercel dev 的 Windows 动态段路由 `api/graph/[op].ts` 不生效(请求落到 Vite SPA),改静态文件+重写规避。`GET /api/*` 返回 `{ok,route}` 是刻意健康探针,不是 bug。
- **冗余**: 同一仓库连了 3 个 Vercel 项目(evolvmind-2025 / -7p31 / -qzhu),每次 push 三份构建。域名 evolvmind-2025.vercel.app 归属原项目;两个后缀项目是多余的,建议删(待用户确认)。
- **以后加 API 端点前先数函数**: `find api -name "*.ts" -not -path "*_lib*" | wc -l` ≤ 12;超限就往 graph-ops 式分发器里并。

## 追记2:APK CI 三连坑(2026-09-29 全修,构建已过)
1. `android-actions/setup-android@v3` 在 cmdline-tools 16.0 下装废弃 `tools` 包必败 -> **删掉**,ubuntu-latest runner 自带 SDK。
2. Capacitor CLI 要 **Node >=22**(workflow 从 20 升 22)。
3. Capacitor 7 的 variables.gradle sourceCompatibility=**21** -> setup-java 用 **21**(不是 17)。
最终 workflow:checkout -> node22+java21 -> npm ci -> vite build -> cap sync -> gradlew assembleDebug -> upload artifact。产物 3MB debug APK,保留 90 天。

## 追记3:增量话题回填(2026-09-29)
- 检查发现: demo 980 节点 topic_labels 全缺(历史清理误删),真实用户 0b47884f 14 节点未分类,159f52bd 117/117 全。
- 新增 `/api/graph/topicize-backfill`(挂 graph-ops 分发器,不增函数数):scope 内差集→分批 200 LLM 分类→写缓存,幂等,单次上限 10 批(2000 节点),响应带 remaining 供续跑。分类核心抽至 `topicClassify.ts`(topicize 同步复用)。
- KnowledgePage 挂载时凡有未分类节点即自动触发回填(旧逻辑仅表全空才兜底),完成后重读标签。
- 已执行: demo 980/980 分类完成,主题数 53,「其他」桶从 253(08-19 基线)降到 **45**。
- 待观察: 真实用户 0b47884f 的 14 节点等其本人打开知识页时自动回填(需其 Bearer,服务端不能越权代跑)。

## 追记4:小图看不到话题层的真因(2026-09-29)
- 用户报"我那个号还是没抽话题": 0b47884f(163 邮箱)14 节点全是验收垃圾数据且未分类;159f52bd 117 节点虽已全部分类,但 **COMMUNITY_VIEW_THRESHOLD=150 把整个话题层短路**——小于 150 节点的账号永远看不到话题视图。
- 修复: 阈值只挡模块度碎片回退,语义主题(nodeTopicMap.size>0)任意规模启用。
- 0b47884f 的 14 节点已本地 LLM(MINIMAX_CHAT_API_KEY;MINIMAX_API_KEY 无 chat 权限)+ SQL 直补: 知识管理7/其他6/软件工程1。
- 教训: **MINIMAX_API_KEY 只对 embeddings 有权限,chat/completions 要用 MINIMAX_CHAT_API_KEY**(本地脚本直连时 .env.local 的值带引号要剥)。
