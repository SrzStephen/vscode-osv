import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/osv-language-server/test/**/*.test.ts"],
  },
});
