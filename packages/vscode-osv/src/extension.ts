import * as vscode from "vscode";
import {
  ExecuteCommandRequest,
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import {
  ALWAYS,
  NEVER,
  RUN,
  appendIgnore,
  handleSuggestLockCommand,
  saveDirtyDocumentsUnder,
  type LockCommandHost,
  type SuggestLockCommandParams,
} from "./commandRunner.js";
import { trustHover } from "./hoverTrust.js";
import {
  DOCUMENT_GLOB,
  emptyCounts,
  isAlarming,
  isOsvFile,
  severityOf,
  severitySummary,
  statusBarText,
  totalOf,
  type StatusState,
} from "./statusBar.js";

export interface OsvApi {
  statusBarText(): string;
}

const TERMINAL_NAME = "OSV";
const SETTING_KEYS = [
  "enable",
  "ecosystems",
  "minimumSeverity",
  "onlyShowFixable",
  "scanLockfiles",
  "scanWorkspaceOnStartup",
  "cacheTtlHours",
  "apiBaseUrl",
  "caCertificatePath",
  "ignoredVulnerabilities",
  "offerLockCommand",
] as const;

let client: LanguageClient | undefined;

function readSettings(): Record<string, unknown> {
  const config = vscode.workspace.getConfiguration("osv");
  return Object.fromEntries(SETTING_KEYS.map((key) => [key, config.get(key)]));
}

const lockCommandHost: LockCommandHost = {
  async runInTerminal(cwd, command) {
    // A fix applied through workspace/applyEdit leaves the manifest dirty; the command reads it from disk.
    const docs = vscode.workspace.textDocuments
      .filter((d) => d.uri.scheme === "file")
      .map((d) => ({ isDirty: d.isDirty, fsPath: d.uri.fsPath, save: () => d.save() }));
    if (!(await saveDirtyDocumentsUnder(cwd, docs))) {
      void vscode.window.showErrorMessage(`OSV: could not save the edited files in ${cwd}; \`${command}\` was not run.`);
      return;
    }
    const terminal =
      vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && (t.creationOptions as vscode.TerminalOptions).cwd === cwd) ??
      vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
    terminal.show();
    terminal.sendText(command);
  },
  ask: (message) => vscode.window.showInformationMessage(message, RUN, ALWAYS, NEVER),
  setOfferLockCommand: (value) => vscode.workspace.getConfiguration("osv").update("offerLockCommand", value, vscode.ConfigurationTarget.Global),
};

async function addIgnore(id: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("osv");
  const current = config.inspect<string[]>("ignoredVulnerabilities")?.workspaceValue ?? [];
  const next = appendIgnore(current, id);
  if (next) await config.update("ignoredVulnerabilities", next, vscode.ConfigurationTarget.Workspace);
}

function statusTooltip(state: StatusState): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: ["osv.scanWorkspaceUi", "osv.clearCacheUi", "osv.showLog"] };
  md.appendMarkdown("**OSV Vulnerabilities**\n\n");
  if (state.scanning) md.appendMarkdown("Scanning the workspace…\n\n");
  else if (state.offline) md.appendMarkdown("osv.dev is unreachable; showing cached results.\n\n");
  else if (totalOf(state.counts) === 0) md.appendMarkdown("No known vulnerabilities in this file.\n\n");
  else md.appendMarkdown(`${severitySummary(state.counts)} in this file.\n\n`);
  md.appendMarkdown("[$(search) Scan workspace](command:osv.scanWorkspaceUi) · [$(refresh) Rescan](command:osv.clearCacheUi) · [$(output) Log](command:osv.showLog)");
  return md;
}

export function activate(context: vscode.ExtensionContext): OsvApi {
  const serverModule = context.asAbsolutePath("dist/server.js");
  const proxy = vscode.workspace.getConfiguration("http").get<string>("proxy");
  const options = proxy ? { env: { ...process.env, HTTPS_PROXY: proxy } } : {};
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc, options },
    debug: { module: serverModule, transport: TransportKind.ipc, options },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", pattern: DOCUMENT_GLOB }],
    synchronize: { configurationSection: "osv" },
    initializationOptions: { settings: readSettings(), cacheDir: context.globalStorageUri.fsPath, clientHandlesIgnore: true },
    middleware: { provideHover: trustHover },
  };
  const languageClient = new LanguageClient("osv", "OSV", serverOptions, clientOptions);
  client = languageClient;
  const log = (e: unknown) => languageClient.outputChannel.appendLine(`OSV: ${e instanceof Error ? e.message : String(e)}`);

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  item.command = "workbench.actions.view.problems";
  item.name = "OSV";
  let offline = false;
  let scanning = 0;
  const refresh = () => {
    const doc = vscode.window.activeTextEditor?.document;
    const counts = emptyCounts();
    if (doc) {
      for (const d of vscode.languages.getDiagnostics(doc.uri)) {
        if (d.source === "osv") counts[severityOf((d as { data?: unknown }).data)]++;
      }
    }
    const state: StatusState = {
      matching: !!doc && doc.uri.scheme === "file" && isOsvFile(doc.uri.fsPath),
      counts,
      offline,
      scanning: scanning > 0,
    };
    void vscode.commands.executeCommand("setContext", "osv.activeFileScanned", state.matching);
    const text = statusBarText(state);
    item.text = text ?? "";
    item.backgroundColor = isAlarming(state) ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
    item.tooltip = text ? statusTooltip(state) : undefined;
    if (text) item.show();
    else item.hide();
  };

  languageClient.onNotification("osv/status", (params: { offline: boolean }) => {
    offline = params.offline;
    refresh();
  });
  languageClient.onNotification("osv/suggestLockCommand", (params: SuggestLockCommandParams) => {
    const offerLockCommand = vscode.workspace.getConfiguration("osv").get<string>("offerLockCommand", "ask");
    handleSuggestLockCommand(params, { offerLockCommand }, vscode.workspace.isTrusted, lockCommandHost).catch(log);
  });
  languageClient.onNotification("osv/addIgnore", (params: { id: string }) => {
    addIgnore(params.id).catch(log);
  });

  const serverCommand = (command: string) => languageClient.sendRequest(ExecuteCommandRequest.type, { command, arguments: [] });
  const uiCommand = (id: string, run: () => PromiseLike<unknown>) =>
    vscode.commands.registerCommand(id, () => Promise.resolve(run()).catch((e: unknown) => vscode.window.showErrorMessage(`OSV: ${e instanceof Error ? e.message : String(e)}`)));

  context.subscriptions.push(
    item,
    vscode.languages.onDidChangeDiagnostics(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    uiCommand("osv.scanWorkspaceUi", async () => {
      scanning++;
      refresh();
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "OSV: scanning workspace" }, () => serverCommand("osv.scanWorkspace"));
      } finally {
        scanning--;
        refresh();
      }
    }),
    uiCommand("osv.clearCacheUi", () => serverCommand("osv.clearCache")),
    vscode.commands.registerCommand("osv.showLog", () => languageClient.outputChannel.show()),
  );

  languageClient.start().catch((e: unknown) => {
    log(e);
    void vscode.window.showErrorMessage("OSV: the language server failed to start. See the OSV output log.");
  });
  refresh();

  return { statusBarText: () => item.text };
}

export async function deactivate(): Promise<void> {
  const c = client;
  client = undefined;
  if (c?.needsStop()) await c.stop();
}
