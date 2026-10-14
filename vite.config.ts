import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
// 构建标识:版本可见化,用于验证 PWA 自动更新是否生效(设置页展示)
const BUILD_SHA = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' } })()
const BUILD_TIME = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'EvolvMind 进化心智',
        short_name: 'EvolvMind',
        description: '个人知识演化系统：捕获、图谱、洞察',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fbfbfd',
        theme_color: '#0a84ff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 静态资源预缓存;API/Supabase 请求一律走网络(NetworkOnly),避免数据过期或写操作被缓存
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: /\/api\/.*/i, handler: 'NetworkOnly' },
          { urlPattern: /supabase\.co\/.*/i, handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    proxy: {
      // Local full-stack workaround: let Vite serve the frontend while Vercel
      // dev serves /api functions on port 3000. This avoids the SPA fallback
      // rewrite interfering with Vite's dev-only module URLs.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      }
    }
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
