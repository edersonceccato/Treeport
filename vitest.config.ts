import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const schemaSrc = fileURLToPath(new URL('./packages/schema/src', import.meta.url));
const coreSrc = fileURLToPath(new URL('./packages/core/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // aponta o schema para o fonte, para rodar os testes sem build prévio
      '@treeport/schema': schemaSrc,
      '@treeport/core': coreSrc,
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    environment: 'node',
  },
});
