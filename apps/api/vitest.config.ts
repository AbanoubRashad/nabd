import { defineConfig } from 'vitest/config';

// The first test pays for loading Fastify, Swagger and every zod schema (several seconds on a cold
// Windows machine), which flaked against the 5 s default.
export default defineConfig({ test: { testTimeout: 20_000 } });
