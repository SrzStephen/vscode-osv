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
import { DOCUMENT_GLOB, isOsvFile, statusBarText } from "./statusBar.js";

export interface OsvApi {
  statusBarText(): string;
}

const TERMINAL_NAME = "OSV";
const SETTING_KEYS = [
  "enable",
  "ecosystems",
  "minimumSeverity",
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
  const refresh = () => {
    const doc = vscode.window.activeTextEditor?.document;
    const text =
      doc &&
      statusBarText({
        matching: doc.uri.scheme === "file" && isOsvFile(doc.uri.fsPath),
        vulnerable: vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === "osv").length,
        offline,
      });
    item.text = text ?? "";
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
    uiCommand("osv.scanWorkspaceUi", () =>
      vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "OSV: scanning workspace" }, () => serverCommand("osv.scanWorkspace")),
    ),
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
