/* eslint-disable @typescript-eslint/no-require-imports -- the extension host loads this file as CommonJS */
// Runs inside the VS Code extension host; scripted so the recording is reproducible.
const vscode = require("vscode");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (...a) => vscode.commands.executeCommand(...a);

async function until(label, fn, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error("timeout: " + label);
    await sleep(300);
  }
}

exports.run = async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const pkg = vscode.Uri.joinPath(root, "package.json");
  await cmd("workbench.action.closeAllEditors");
  await cmd("workbench.action.closeSidebar");
  await cmd("workbench.action.closePanel");
  await cmd("workbench.action.closeAuxiliaryBar");
  const doc = await vscode.workspace.openTextDocument(pkg);
  const editor = await vscode.window.showTextDocument(doc);
  await sleep(2500); // idle frame: file open, nothing flagged yet

  await until("package.json diagnostics", () => vscode.languages.getDiagnostics(pkg).filter((d) => d.source === "osv").length >= 2);
  await sleep(2500); // status bar breakdown + squiggles

  // Hover the lodash version.
  const lodash = vscode.languages.getDiagnostics(pkg).find((d) => d.message.startsWith("lodash"));
  editor.selection = new vscode.Selection(lodash.range.start.translate(0, 2), lodash.range.start.translate(0, 2));
  await cmd("editor.action.showHover");
  await sleep(5500);
  await cmd("closeParameterHints");
  await cmd("workbench.action.focusActiveEditorGroup");
  await cmd("editor.action.hideHover");

  // Workspace overview: open the view, scan, show it fill.
  await cmd("osv.overview.focus");
  await sleep(800);
  require("fs").writeFileSync(path.join(__dirname, "marker"), "1"); // record.sh then drags the sash wider
  await sleep(2500);
  await cmd("osv.scanWorkspaceUi");
  await until("requirements.txt diagnostics", () => vscode.languages.getDiagnostics(vscode.Uri.joinPath(root, "requirements.txt")).some((d) => d.source === "osv"));
  await sleep(3500);

  // Group by severity, then back.
  await cmd("osv.overview.groupBySeverity");
  await sleep(3000);
  await cmd("osv.overview.groupByFile");
  await sleep(1500);

  // Quick-fix every finding in package.json (real data: lodash needs two bumps).
  await vscode.window.showTextDocument(doc);
  for (let i = 0; i < 5; i++) {
    const next = vscode.languages.getDiagnostics(pkg).find((d) => d.source === "osv");
    if (!next) break;
    editor.selection = new vscode.Selection(next.range.start.translate(0, 2), next.range.start.translate(0, 2));
    await cmd("editor.action.quickFix");
    await sleep(2200);
    await cmd("acceptSelectedCodeAction");
    await sleep(3500);
  }
  await cmd("workbench.action.files.save");
  await sleep(3500);
};
