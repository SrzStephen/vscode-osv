import { build, type BuildOptions } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const serverDir = fileURLToPath(new URL("../osv-language-server/", import.meta.url));
const common = { bundle: true, platform: "node", target: "node20", format: "cjs", logLevel: "info" } satisfies BuildOptions;

// The VSIX bundles the language server; build it fresh and copy it next to the extension.
execFileSync(process.execPath, ["--import", "tsx", `${serverDir}build.mts`], { stdio: "inherit" });
mkdirSync(`${dir}dist`, { recursive: true });
copyFileSync(`${serverDir}dist/server.js`, `${dir}dist/server.js`);

await build({ ...common, entryPoints: { extension: `${dir}src/extension.ts` }, outdir: `${dir}dist`, external: ["vscode"], sourcemap: true });

// Integration-test harness: runTest runs in plain Node, the suite inside the extension host.
if (process.argv.includes("--test")) {
  await build({
    ...common,
    entryPoints: {
      runTest: `${dir}test/integration/runTest.ts`,
      "suite/index": `${dir}test/integration/suite/index.ts`,
      "suite/smoke.test": `${dir}test/integration/suite/smoke.test.ts`,
    },
    outdir: `${dir}dist/test`,
    external: ["vscode", "mocha", "@vscode/test-electron"],
  });
}
