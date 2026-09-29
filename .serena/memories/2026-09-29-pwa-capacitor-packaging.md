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
