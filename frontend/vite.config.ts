import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'build',
  },
  server: {
    host: '0.0.0.0',
    port: 9001,
    strictPort: false,
    allowedHosts: true,
    hmr: false,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:9002',
        changeOrigin: true,
      }
    }
  },
})