import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { startFakeOsv } from "../../../../osv-language-server/test/helpers/fakeOsv";
import type { OsvRecord } from "../../../../osv-language-server/src/core/types";
import type { OsvApi } from "../../../src/extension";

const GHSA = "GHSA-29mw-wpgm-hmr9";
const WAIT_MS = 10_000;

async function eventually<T>(what: string, probe: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out after ${WAIT_MS} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

suite("OSV extension smoke test", () => {
  let fake: Awaited<ReturnType<typeof startFakeOsv>>;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<OsvApi>("srzstephen.vscode-osv");
    assert.ok(ext, "extension is installed");
    const fixtures = join(ext.extensionPath, "..", "osv-language-server", "test", "fixtures", "osv");
    const record = JSON.parse(readFileSync(join(fixtures, `${GHSA}.json`), "utf8")) as OsvRecord;
    fake = await startFakeOsv({ packages: { "npm|lodash|4.17.15": [GHSA] }, records: { [GHSA]: record } });
    const config = vscode.workspace.getConfiguration("osv");
    // Never prompt or open a terminal from the code action's follow-up lock command.
    await config.update("offerLockCommand", "never", vscode.ConfigurationTarget.Global);
    await config.update("apiBaseUrl", fake.url, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await fake.close();
  });

  test("flags, explains and fixes a vulnerable dependency", async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    assert.ok(root, "a workspace folder is open");
    const uri = vscode.Uri.joinPath(root.uri, "package.json");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const api = (await vscode.extensions.getExtension<OsvApi>("srzstephen.vscode-osv")!.activate()) as OsvApi;

    const diagnostic = await eventually("an osv diagnostic on the lodash version", () =>
      vscode.languages.getDiagnostics(uri).find((d) => d.source === "osv"),
    );
    assert.strictEqual(doc.getText(diagnostic.range), "^4.17.15");
    await eventually("the status bar to report one vulnerable dependency", () =>
      /^\$\(shield\) OSV: 1 (critical|high|medium|low)$/.test(api.statusBarText()) ? true : undefined,
    );

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri, diagnostic.range.start);
    const hoverText = hovers
      .flatMap((h) => h.contents)
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n");
    assert.ok(hoverText.includes("command:osv.update"), `hover has an update link:\n${hoverText}`);

    const title = "Update lodash to 4.17.21";
    const actions = await eventually(`code action "${title}"`, async () => {
      const found = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", uri, diagnostic.range);
      return found.some((a) => a.title === title) ? found : undefined;
    });
    const action = actions.find((a) => a.title === title)!;
    assert.ok(action.edit, "the action carries an edit");
    assert.ok(await vscode.workspace.applyEdit(action.edit), "the edit applies");
    if (action.command) await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments ?? []));
    assert.ok(doc.getText().includes('"^4.17.21"'), `text after fix:\n${doc.getText()}`);
  });
});
