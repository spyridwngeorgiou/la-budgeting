import { defineConfig } from "vitest/config";
import path from "node:path";

// Paid model evals (src/**/*.eval.ts). Separate from vitest.config.mts so
// `npm test` never runs them; each eval is also gated by AI_EVAL=1.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.eval.ts"],
    testTimeout: 60 * 60 * 1000,
  },
});
