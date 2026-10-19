import { defineConfig } from 'vitest/config';

// Integration tests need Docker (Testcontainers); `pnpm test` skips them, `pnpm test:int` runs them.
export default defineConfig({
  test: { include: ['test/**/*.int.ts'], testTimeout: 60_000, hookTimeout: 180_000 },
});
