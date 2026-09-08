import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.ts',
      'packages/**/*.test.ts',
      'services/**/*.test.ts',
      'infra/policies/**/*.test.ts',
      'db/tests/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
});
