import { defineConfig } from 'vitest/config';

const bench = process.env.BENCH === '1';

export default defineConfig({
  test: {
    // Benchmarks are timing-sensitive, so they only run via `pnpm bench`.
    include: bench ? ['test/bench/**/*.test.ts'] : ['test/**/*.test.ts'],
    exclude: bench ? [] : ['test/bench/**'],
    // ROM conformance tests run whole programs; give them room on slow CI machines.
    testTimeout: 60_000,
  },
});
