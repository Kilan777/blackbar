import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the static build works on any host or sub-path (e.g. GitHub Pages).
  base: './',
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});
