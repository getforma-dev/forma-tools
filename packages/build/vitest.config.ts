import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@getforma/compiler': resolve(__dirname, '../compiler/src/index.ts'),
    },
  },
});
