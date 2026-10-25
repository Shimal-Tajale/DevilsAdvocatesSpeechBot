import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 80,
    strictPort: true, // fail loudly instead of silently picking another port
    host: true,
    allowedHosts: true, // lets the ngrok hostname through (hackathon only)
    // The backend routes have no prefix, so strip /api and /ws before forwarding:
    //   /api/speech -> http://localhost:8000/speech, /ws/events -> ws://localhost:8000/events
    // Backend port: 8000 is the one bridge/bridge.py connects to; nothing in backend/ sets it.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        rewrite: (p) => p.replace(/^\/ws/, ''),
      },
    },
  },
})
