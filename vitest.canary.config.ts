import { defineConfig } from "vitest/config";

// Used only by `npm run test:canary`; the default config excludes the live test.
export default defineConfig({
  test: { include: ["packages/osv-language-server/test/canary/**/*.test.ts"], testTimeout: 60_000 },
});
