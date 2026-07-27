import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
