import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from "vscode-jsonrpc/node";
import type { Diagnostic, WorkspaceEdit } from "vscode-languageserver";
import type { Settings } from "../../src/core/settings.js";

const PACKAGE_DIR = join(__dirname, "..", "..");

export interface TestServerOptions {
  osvUrl: string;
  cacheDir: string;
  rootDir: string;
  settings?: Partial<Settings>;
  clientHandlesIgnore?: boolean;
  /** Run this prebuilt bundle with plain node instead of the TypeScript sources. */
  bundle?: string;
}

export interface TestServer {
  conn: MessageConnection;
  /** The latest diagnostics published for uri, waiting for the first publish if none has arrived. */
  diagnostics(uri: string, timeoutMs?: number): Promise<Diagnostic[]>;
  /** Resolves with the params of the first notification of `method` (already received or still to come). */
  notification(method: string, timeoutMs?: number): Promise<unknown>;
  notifications: { method: string; params: unknown }[];
  appliedEdits: WorkspaceEdit[];
  stop(): Promise<void>;
}

/** Starts the server over stdio and plays the client side of the handshake. */
export async function startTestServer(opts: TestServerOptions): Promise<TestServer> {
  const args = opts.bundle ? [opts.bundle, "--stdio"] : ["--import", "tsx", "src/serverMain.ts", "--stdio"];
  const child: ChildProcess = spawn(process.execPath, args, { cwd: PACKAGE_DIR, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr?.resume();
  const conn = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!));

  const notifications: TestServer["notifications"] = [];
  const appliedEdits: WorkspaceEdit[] = [];
  const published = new Map<string, Diagnostic[]>();
  const waiters: (() => void)[] = [];
  const wake = () => waiters.splice(0).forEach((w) => w());

  conn.onNotification((method: string, params: unknown) => {
    notifications.push({ method, params });
    if (method === "textDocument/publishDiagnostics") {
      const p = params as { uri: string; diagnostics: Diagnostic[] };
      published.set(p.uri, p.diagnostics);
    }
    wake();
  });
  conn.onRequest("workspace/applyEdit", (params: { edit: WorkspaceEdit }) => {
    appliedEdits.push(params.edit);
    return { applied: true };
  });
  conn.onRequest("client/registerCapability", () => null);
  conn.listen();

  const waitFor = <T>(read: () => { value: T } | undefined, what: string, timeoutMs: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
      const check = () => {
        const hit = read();
        if (!hit) {
          waiters.push(check);
          return;
        }
        clearTimeout(timer);
        resolve(hit.value);
      };
      check();
    });

  const rootUri = pathToFileURL(opts.rootDir).href;
  await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "ws" }],
    capabilities: { workspace: { applyEdit: true, workspaceFolders: true, didChangeWatchedFiles: { dynamicRegistration: true } } },
    initializationOptions: {
      settings: { apiBaseUrl: opts.osvUrl, ...opts.settings },
      cacheDir: opts.cacheDir,
      clientHandlesIgnore: opts.clientHandlesIgnore ?? false,
    },
  });
  await conn.sendNotification("initialized", {});

  return {
    conn,
    notifications,
    appliedEdits,
    diagnostics: (uri, timeoutMs = 10_000) =>
      waitFor(() => (published.has(uri) ? { value: published.get(uri)! } : undefined), `diagnostics for ${uri}`, timeoutMs),
    notification: (method, timeoutMs = 10_000) =>
      waitFor(
        () => {
          const n = notifications.find((x) => x.method === method);
          return n ? { value: n.params } : undefined;
        },
        `${method} notification`,
        timeoutMs,
      ),
    async stop() {
      try {
        await conn.sendRequest("shutdown");
        await conn.sendNotification("exit");
      } catch {
        // the server may already be gone
      }
      conn.dispose();
      child.kill();
    },
  };
}
