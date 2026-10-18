import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/osv-language-server/test/**/*.test.ts", "packages/vscode-osv/test/unit/**/*.test.ts"],
    // The live canary hits api.osv.dev; it only runs via `npm run test:canary`.
    exclude: ["**/node_modules/**", "**/dist/**", "packages/osv-language-server/test/canary/**"],
  },
});
