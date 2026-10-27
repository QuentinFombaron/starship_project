import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1200 },
  resolve: { alias: { '@content': new URL('./content', import.meta.url).pathname } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
