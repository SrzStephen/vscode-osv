import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CodeActionKind,
  DidChangeWatchedFilesNotification,
  MessageType,
  ShowMessageNotification,
  TextDocumentSyncKind,
  TextDocuments,
  type Connection,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiskCache } from "./core/cache.js";
import { defaultCacheDir } from "./core/cacheDir.js";
import { nodeFileSource, overlayFileSource, type FileSource } from "./core/fileSource.js";
import { findOsvScannerToml, IgnoreMatcher, parseOsvScannerToml } from "./core/ignores.js";
import { OsvClient } from "./core/osvClient.js";
import { OsvService } from "./core/osvService.js";
import { createDispatcher } from "./core/tls.js";
import { USER_AGENT } from "./core/userAgent.js";
import { scanDocument, type ScanContext } from "./core/scanner.js";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "./core/settings.js";
import type { Finding } from "./core/types.js";
import { discoverFiles, scanFiles } from "./core/workspaceScanner.js";
import { ALL_MODULES } from "./ecosystems/index.js";
import { codeActionsFor, toWorkspaceEdit } from "./features/codeActions.js";
import { toDiagnostic } from "./features/diagnostics.js";
import { hoverAt } from "./features/hover.js";
import { ignoreEdit } from "./features/ignoreEdit.js";
import { FindingStore } from "./features/store.js";

export const COMMANDS = ["osv.update", "osv.afterUpdate", "osv.scanWorkspace", "osv.getFindings", "osv.clearCache", "osv.ignore"];

const DEBOUNCE_MS = 750;

interface InitializationOptions {
  settings?: unknown;
  cacheDir?: string;
  clientHandlesIgnore?: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const isInside = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
};

/** The path of a file: URI; other schemes (untitled, git) are not scanned. */
function filePath(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined; // malformed file: URI
  }
}

export function startServer(connection: Connection, opts: { cacheDir?: string }): void {
  const documents = new TextDocuments(TextDocument);
  const store = new FindingStore();
  let settings: Settings = DEFAULT_SETTINGS;
  let clientHandlesIgnore = false;
  let canWatchFiles = false;
  let cacheDir = opts.cacheDir ?? defaultCacheDir();
  let roots: string[] = [];

  let cache: DiskCache | undefined;
  let service: { baseUrl: string; caCertificatePath: string; osv: OsvService } | undefined;
  const getCache = (): DiskCache => (cache ??= new DiskCache(cacheDir));
  const getService = (): OsvService => {
    if (service?.baseUrl !== settings.apiBaseUrl || service.caCertificatePath !== settings.caCertificatePath) {
      const client = new OsvClient({ baseUrl: settings.apiBaseUrl, userAgent: USER_AGENT, dispatcher: createDispatcher(settings.caCertificatePath) });
      service = { baseUrl: settings.apiBaseUrl, caCertificatePath: settings.caCertificatePath, osv: new OsvService(client, getCache(), () => settings.cacheTtlHours) };
    }
    return service.osv;
  };

  /** The document version each URI's stored findings were computed from. */
  const scannedVersion = new Map<string, number>();
  const inFlight = new Map<string, AbortController>();
  const timers = new Map<string, NodeJS.Timeout>();
  /** URIs whose diagnostics came from a workspace scan and so outlive the editor tab. */
  const workspaceUris = new Set<string>();
  let offline = false;

  const logError = (what: string, e: unknown) => connection.console.error(`${what}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  const guarded = <A extends unknown[]>(what: string, fn: (...args: A) => Promise<void> | void) =>
    async (...args: A): Promise<void> => {
      try {
        await fn(...args);
      } catch (e) {
        logError(what, e);
      }
    };

  const files: FileSource = overlayFileSource((path) => documents.get(pathToFileURL(path).href)?.getText(), nodeFileSource);

  const rootFor = (path: string): string => roots.filter((r) => isInside(r, path)).sort((a, b) => b.length - a.length)[0] ?? dirname(path);

  async function contextFor(path: string, rootDir: string, overrides: Partial<Settings> = {}): Promise<ScanContext> {
    const effective = { ...settings, ...overrides };
    const tomlPath = await findOsvScannerToml(path, rootDir, files);
    const toml = tomlPath ? parseOsvScannerToml((await files.read(tomlPath)) ?? "") : [];
    return {
      files,
      osv: getService(),
      settings: effective,
      ignores: new IgnoreMatcher(effective.ignoredVulnerabilities, toml, new Date()),
      rootDir,
      log: (m) => connection.console.warn(m),
    };
  }

  const publish = (uri: string, findings: Finding[]) => connection.sendDiagnostics({ uri, diagnostics: findings.map(toDiagnostic) });

  function setOffline(value: boolean): void {
    if (value === offline) return;
    offline = value;
    void connection.sendNotification("osv/status", { offline });
  }

  /**
   * Scans the open document now, superseding any pending or in-flight scan of it.
   * Resolves true when the stored findings are current for the version scanned.
   */
  async function scanNow(uri: string): Promise<boolean> {
    clearTimeout(timers.get(uri));
    timers.delete(uri);
    inFlight.get(uri)?.abort();
    const doc = documents.get(uri);
    const path = filePath(uri);
    if (!doc || path === undefined) return false;

    // Text and version are captured together: the document may move on while the scan runs.
    const { version } = doc;
    const text = doc.getText();
    const controller = new AbortController();
    inFlight.set(uri, controller);
    try {
      const ctx = await contextFor(path, rootFor(path));
      const result = await scanDocument(uri, path, text, ctx, controller.signal);
      if (controller.signal.aborted) return false;
      // A parse error makes no lookup, so it says nothing about whether OSV is reachable.
      if (result.parseError) return false;
      setOffline(result.offline);
      store.set(uri, result.findings);
      scannedVersion.set(uri, version);
      publish(uri, result.findings);
      return true;
    } catch (e) {
      if (!controller.signal.aborted) logError(`scan of ${uri}`, e);
      return false;
    } finally {
      if (inFlight.get(uri) === controller) inFlight.delete(uri);
    }
  }

  function scheduleScan(uri: string): void {
    clearTimeout(timers.get(uri));
    timers.set(
      uri,
      setTimeout(() => void scanNow(uri), DEBOUNCE_MS),
    );
  }

  const rescanOpenDocuments = (under?: string) =>
    Promise.all(
      documents
        .all()
        .filter((d) => {
          const path = filePath(d.uri);
          return path !== undefined && (under === undefined || isInside(under, path));
        })
        .map((d) => scanNow(d.uri)),
    );

  async function scanWorkspace(minimumSeverity?: unknown): Promise<Finding[]> {
    const override = minimumSeverity === undefined ? undefined : normalizeSettings({ minimumSeverity }).minimumSeverity;
    // A severity override is a one-off query; it must not replace what the editor shows.
    const record = override === undefined || override === settings.minimumSeverity;
    const all: Finding[] = [];
    let anyOffline = false;
    // A document edited (or opened) while this scan runs has a newer scan of its own; this one must not overwrite it.
    const versionsAtStart = new Map(documents.all().map((d) => [d.uri, d.version]));
    for (const root of roots) {
      const paths = await discoverFiles(root, ALL_MODULES, { onError: (path, message) => connection.console.warn(`workspace scan: skipped ${path}: ${message}`) });
      // Each file is governed by its nearest osv-scanner.toml (as for open documents), so files are scanned in one batch per toml.
      const byToml = new Map<string | undefined, string[]>();
      for (const path of paths) {
        const toml = await findOsvScannerToml(path, root, files);
        byToml.set(toml, [...(byToml.get(toml) ?? []), path]);
      }
      for (const group of byToml.values()) {
        const ctx = await contextFor(group[0]!, root, override ? { minimumSeverity: override } : {});
        const result = await scanFiles(group, ctx);
        anyOffline ||= result.offline;
        all.push(...result.findings);
        if (!record) continue;
        for (const path of group) {
          const uri = pathToFileURL(path).href;
          if (result.parseErrors.some((p) => p.path === path)) continue;
          const findings = result.findings.filter((f) => f.uri === uri);
          const doc = documents.get(uri);
          if (doc && doc.version !== versionsAtStart.get(uri)) continue;
          workspaceUris.add(uri);
          store.set(uri, findings);
          if (doc) scannedVersion.set(uri, doc.version);
          publish(uri, findings);
        }
      }
    }
    setOffline(anyOffline);
    return all;
  }

  /** Whether stored findings for `uri` predate the open document's current text. */
  const isStale = (uri: string): boolean => {
    const doc = documents.get(uri);
    return doc !== undefined && scannedVersion.get(uri) !== doc.version;
  };

  async function update(uri: string, key: string): Promise<void> {
    const original = store.byKey(uri, key);
    if (!original) {
      connection.console.warn(`osv.update: no finding ${key} for ${uri}`);
      return;
    }
    const { name, current } = original;
    const notApplied = () =>
      connection.sendNotification(ShowMessageNotification.type, {
        type: MessageType.Info,
        message: `${name} is no longer at ${current}; the fix was not applied.`,
      });
    const targets = (f: Finding) => [...new Set([f.uri, ...(f.update?.edit.map((e) => e.uri) ?? [])])];
    const sameFinding = (f: Finding) => f.name === name && f.current === current;

    let finding: Finding | undefined = original;
    const stale = targets(original).filter(isStale);
    if (stale.length > 0) {
      const fresh = await Promise.all(stale.map(scanNow));
      finding = fresh.every(Boolean) ? store.get(uri).find(sameFinding) : undefined;
      if (!finding) {
        await notApplied();
        return;
      }
    }

    const plan = finding.update;
    if (plan && plan.edit.length > 0) {
      const { applied } = await connection.workspace.applyEdit(toWorkspaceEdit(plan));
      if (!applied) {
        await Promise.all(targets(finding).map(scanNow));
        await notApplied();
        return;
      }
    }
    afterUpdate(finding);
  }

  function afterUpdate(finding: Finding): void {
    const lock = finding.update?.lockCommand;
    if (lock) void connection.sendNotification("osv/suggestLockCommand", { cwd: lock.cwd, command: lock.command });
  }

  async function ignore(id: string): Promise<void> {
    if (clientHandlesIgnore) {
      void connection.sendNotification("osv/addIgnore", { id });
      return;
    }
    const root = roots[0];
    if (root === undefined) {
      connection.console.warn("osv.ignore: no workspace folder to hold osv-scanner.toml");
      return;
    }
    const tomlPath = join(root, "osv-scanner.toml");
    const edit = ignoreEdit(pathToFileURL(tomlPath).href, await files.read(tomlPath), id);
    const { applied } = await connection.workspace.applyEdit(edit);
    if (!applied) connection.console.warn("osv.ignore: the client did not apply the osv-scanner.toml edit");
  }

  async function executeCommand(command: string, args: unknown[]): Promise<unknown> {
    const arg = asRecord(args[0]);
    const uri = typeof arg.uri === "string" ? arg.uri : "";
    // The hover link sends `findingKey` (spec §10.4); code actions send `key`.
    const rawKey = arg.key ?? arg.findingKey;
    const key = typeof rawKey === "string" ? rawKey : "";
    switch (command) {
      case "osv.update":
        await update(uri, key);
        return null;
      case "osv.afterUpdate": {
        const finding = store.byKey(uri, key);
        if (finding) afterUpdate(finding);
        return null;
      }
      case "osv.scanWorkspace":
        return scanWorkspace(arg.minimumSeverity);
      case "osv.getFindings":
        return store.get(uri);
      case "osv.clearCache":
        await getCache().clear();
        await rescanOpenDocuments();
        return null;
      case "osv.ignore":
        if (typeof arg.id === "string") await ignore(arg.id);
        return null;
      default:
        connection.console.warn(`unknown command ${command}`);
        return null;
    }
  }

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    const init = asRecord(params.initializationOptions) as InitializationOptions;
    settings = normalizeSettings(init.settings);
    clientHandlesIgnore = init.clientHandlesIgnore === true;
    if (typeof init.cacheDir === "string" && init.cacheDir !== "") cacheDir = init.cacheDir;
    canWatchFiles = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
    roots = (params.workspaceFolders ?? []).filter((f) => f.uri.startsWith("file:")).map((f) => fileURLToPath(f.uri));
    if (roots.length === 0 && params.rootUri?.startsWith("file:")) roots = [fileURLToPath(params.rootUri)];
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
        executeCommandProvider: { commands: COMMANDS },
      },
    };
  });

  connection.onInitialized(
    guarded("startup", async () => {
      if (canWatchFiles) {
        const globs = [...ALL_MODULES.flatMap((m) => [...m.lockfiles, ...(m.relatedFiles ?? [])]), "osv-scanner.toml"];
        await connection.client.register(DidChangeWatchedFilesNotification.type, {
          watchers: globs.map((g) => ({ globPattern: `**/${g}` })),
        });
      }
      await getCache().housekeep(settings.cacheTtlHours);
      if (settings.scanWorkspaceOnStartup) await scanWorkspace();
    }),
  );

  connection.onDidChangeWatchedFiles(
    guarded("watched files", async (params) => {
      const dirs = new Set<string>();
      for (const change of params.changes) {
        const path = filePath(change.uri);
        if (path === undefined) continue;
        dirs.add(dirname(path));
        // A version catalog serves the build files of the project above its gradle/ directory.
        if (path.split(sep).join("/").endsWith("/gradle/libs.versions.toml")) dirs.add(dirname(dirname(path)));
      }
      await Promise.all([...dirs].map((dir) => rescanOpenDocuments(dir)));
    }),
  );

  connection.onDidChangeConfiguration(
    guarded("configuration change", async (params) => {
      const raw = asRecord(params.settings);
      settings = normalizeSettings(raw.osv ?? params.settings);
      await rescanOpenDocuments();
    }),
  );

  connection.onHover((params) => {
    try {
      return hoverAt(store.get(params.textDocument.uri), params.position) ?? null;
    } catch (e) {
      logError("hover", e);
      return null;
    }
  });
  connection.onCodeAction((params) => {
    try {
      return codeActionsFor(params.textDocument.uri, store.get(params.textDocument.uri), params.range);
    } catch (e) {
      logError("code action", e);
      return [];
    }
  });

  connection.onExecuteCommand(async (params) => {
    try {
      return await executeCommand(params.command, params.arguments ?? []);
    } catch (e) {
      logError(`command ${params.command}`, e);
      return params.command === "osv.getFindings" || params.command === "osv.scanWorkspace" ? [] : null;
    }
  });

  // TextDocuments fires onDidOpen then onDidChangeContent for the same version; scan the open once.
  const requested = new Map<string, number>();
  documents.onDidOpen((e) => {
    requested.set(e.document.uri, e.document.version);
    void scanNow(e.document.uri);
  });
  documents.onDidSave((e) => void scanNow(e.document.uri));
  documents.onDidChangeContent((e) => {
    if (requested.get(e.document.uri) === e.document.version) return;
    requested.set(e.document.uri, e.document.version);
    scheduleScan(e.document.uri);
  });
  documents.onDidClose((e) => {
    const uri = e.document.uri;
    clearTimeout(timers.get(uri));
    timers.delete(uri);
    inFlight.get(uri)?.abort();
    requested.delete(uri);
    scannedVersion.delete(uri);
    if (workspaceUris.has(uri)) return;
    store.delete(uri);
    void connection.sendDiagnostics({ uri, diagnostics: [] });
  });

  documents.listen(connection);
  connection.listen();
}
