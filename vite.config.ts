import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
