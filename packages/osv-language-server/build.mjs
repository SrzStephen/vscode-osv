import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));

await build({
  entryPoints: { server: `${dir}src/serverMain.ts` },
  outdir: `${dir}dist`,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  // jsonc-parser's "main" is a UMD build whose relative requires esbuild cannot follow; use its ESM build.
  mainFields: ["module", "main"],
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
