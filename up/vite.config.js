import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  server: {
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 3001}` } }
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(root, 'index.html'),
        financeiro: resolve(root, 'financeiro.html'),
        favoritos: resolve(root, 'favoritos.html'),
        agenda: resolve(root, 'agenda.html'),
        lazer: resolve(root, 'lazer.html')
      }
    }
  }
})
