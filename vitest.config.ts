import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    deps: {
      inline: ['node-rsync']  // Force inline node-rsync so it can be mocked
    }
  }
})
