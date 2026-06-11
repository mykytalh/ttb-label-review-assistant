import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      // Coverage targets pure validation logic. Excluded:
      //   - client.ts: browser-only APIs
      //   - extractor.ts / review.ts: network calls (see docs/EVALUATION.md)
      //   - types.ts: type declarations only
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/lib/types.ts",
        "src/lib/client.ts",
        "src/lib/extractor.ts",
        "src/lib/review.ts",
      ],
      reporter: ["text", "html"],
      // Coverage thresholds for validation and request-guard logic.
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
