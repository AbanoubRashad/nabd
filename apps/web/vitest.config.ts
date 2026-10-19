import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only: the Playwright specs in e2e/ run with `pnpm e2e`.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'e2e/**'] } });
