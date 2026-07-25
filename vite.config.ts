import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      // ⚠️ LEGACY: 早期原型遗留的 LLM 代理，仅供本地调试参考。
      // 当前架构要求前端只调用本项目的 Vercel /api/* 服务端函数，
      // 不应直接代理 LLM provider。确认无本地流程依赖后可删除此段。
      '/api/llm': {
        target: 'https://api.edgefn.net/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llm/, '')
      },
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
