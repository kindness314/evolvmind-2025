import type { CapacitorConfig } from '@capacitor/cli';

// 移动壳策略:WebView 直接加载线上站点(Vercel),前端始终最新;离线能力由 PWA SW 提供。
// 若未来要完全离线打包,改为省略 server.url 并把 API 调用指向绝对地址。
const config: CapacitorConfig = {
  appId: 'com.evolvmind.app',
  appName: 'EvolvMind',
  webDir: 'dist',
  server: {
    url: 'https://evolvmind-2025.vercel.app',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;
