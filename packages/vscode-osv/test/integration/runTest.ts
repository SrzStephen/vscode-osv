import { runTests } from "@vscode/test-electron";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function main(): Promise<void> {
  // Compiled to dist/test/runTest.js, two levels below the extension root.
  const extensionDevelopmentPath = resolve(__dirname, "..", "..");
  const extensionTestsPath = resolve(__dirname, "suite", "index.js");
  // The suite edits the open document; work on a copy so the committed fixture stays untouched.
  const workspace = mkdtempSync(join(tmpdir(), "osv-fixture-"));
  cpSync(resolve(extensionDevelopmentPath, "test", "integration", "fixture"), workspace, { recursive: true });
  const userData = mkdtempSync(join(tmpdir(), "osv-user-data-"));
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, "--disable-extensions", "--user-data-dir", userData],
  });
}

main().catch((e: unknown) => {
  console.error("Integration tests failed:", e);
  process.exit(1);
});
