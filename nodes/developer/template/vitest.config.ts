import { defineConfig } from "vitest/config";

/**
 * Two test buckets:
 *   - `*.test.ts`     — fast unit tests of the handler in isolation.
 *                       Run by `pnpm test`. MANDATORY: at least one passing
 *                       test before the framework will accept the node.
 *   - `*.e2e.test.ts` — opt-in end-to-end tests that spawn the node inside
 *                       a real BrainService + bus and exercise it through
 *                       the runner. Run by `pnpm test:e2e`. Slower (real
 *                       NATS, real LLM calls) so excluded from the default
 *                       pass — CI and the user run them explicitly.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.e2e.test.ts", "node_modules/**", "dist/**"],
    testTimeout: 10000,
  },
});
