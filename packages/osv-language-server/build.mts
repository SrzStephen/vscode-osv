import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));

await build({
  entryPoints: { server: `${dir}src/serverMain.ts`, cli: `${dir}src/cliMain.ts` },
  outdir: `${dir}dist`,
  bundle: true,
  platform: "node",
  // The bundle also runs inside VS Code's own Node (engines.vscode ^1.90.0 ships Node 20), so this is
  // lower than the "engines" floor of the npm package on purpose.
  target: "node20",
  format: "cjs",
  // jsonc-parser's "main" is a UMD build whose relative requires esbuild cannot follow; use its ESM build.
  mainFields: ["module", "main"],
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
