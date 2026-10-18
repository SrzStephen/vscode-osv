import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CodeAction, Hover, MarkupContent, TextDocumentEdit, TextEdit, WorkspaceEdit } from "vscode-languageserver";
import { afterEach, describe, expect, it } from "vitest";
import type { Finding, OsvRecord } from "../src/core/types.js";
import { startFakeOsv } from "./helpers/fakeOsv.js";
import { startTestServer, type TestServer } from "./helpers/lspClient.js";

const GHSA = "GHSA-29mw-wpgm-hmr9";
const record = JSON.parse(readFileSync(join(__dirname, "fixtures", "osv", `${GHSA}.json`), "utf8")) as OsvRecord;

const PACKAGE_JSON = `{\n  "name": "app",\n  "dependencies": {\n    "lodash": "4.17.15"\n  }\n}\n`;
const PACKAGE_LOCK = JSON.stringify({
  name: "app",
  lockfileVersion: 3,
  packages: {
    "": { name: "app", dependencies: { lodash: "4.17.15" } },
    "node_modules/lodash": { version: "4.17.15" },
  },
});
// The position of the version string inside PACKAGE_JSON.
const LODASH_POS = { line: 3, character: 16 };

type Fake = Awaited<ReturnType<typeof startFakeOsv>>;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function tmp(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

async function setup(opts: { lockfile?: boolean; fake?: Fake | "closed"; clientHandlesIgnore?: boolean } = {}) {
  const rootDir = tmp("osv-ws-");
  writeFileSync(join(rootDir, "package.json"), PACKAGE_JSON);
  if (opts.lockfile ?? true) writeFileSync(join(rootDir, "package-lock.json"), PACKAGE_LOCK);

  let fake: Fake;
  if (opts.fake === "closed" || !opts.fake) {
    fake = await startFakeOsv({ packages: { "npm|lodash|4.17.15": [GHSA] }, records: { [GHSA]: record } });
    if (opts.fake === "closed") await fake.close();
    else cleanups.push(() => fake.close());
  } else {
    fake = opts.fake;
  }
  const server = await startTestServer({
    osvUrl: fake.url,
    cacheDir: tmp("osv-cache-"),
    rootDir,
    clientHandlesIgnore: opts.clientHandlesIgnore ?? false,
  });
  cleanups.push(() => server.stop());
  const uri = pathToFileURL(join(rootDir, "package.json")).href;
  const open = (text = PACKAGE_JSON, version = 1) =>
    server.conn.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "json", version, text } });
  return { server, rootDir, uri, open };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const findingsOf = (s: TestServer, uri: string) => s.conn.sendRequest("workspace/executeCommand", { command: "osv.getFindings", arguments: [{ uri }] }) as Promise<Finding[]>;

describe("language server over stdio", { timeout: 30_000 }, () => {
  it("publishes diagnostics on didOpen", async () => {
    const { server, uri, open } = await setup();
    await open();
    const d = await server.diagnostics(uri);
    expect(d[0]).toMatchObject({ source: "osv", code: GHSA });
  });

  it("hover contains the update command link", async () => {
    const { server, uri, open } = await setup();
    await open();
    await server.diagnostics(uri);
    const hover = (await server.conn.sendRequest("textDocument/hover", { textDocument: { uri }, position: LODASH_POS })) as Hover;
    const markdown = (hover.contents as MarkupContent).value;
    expect(markdown).toContain("lodash 4.17.15");
    expect(markdown).toContain("(command:osv.update?");
    expect(markdown).toContain(encodeURIComponent(JSON.stringify([{ uri, findingKey: (await findingsOf(server, uri))[0]!.key }])));
    expect(markdown).toContain("(command:osv.ignore?");
  });

  it("code action edit + afterUpdate sends osv/suggestLockCommand", async () => {
    const { server, rootDir, uri, open } = await setup();
    await open();
    await server.diagnostics(uri);
    const actions = (await server.conn.sendRequest("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: LODASH_POS, end: LODASH_POS },
      context: { diagnostics: [] },
    })) as CodeAction[];
    expect(actions).toHaveLength(1);
    const edit = actions[0]!.edit as WorkspaceEdit;
    expect(edit.changes![uri]![0]!.newText).toBe("4.17.21");
    const { command, arguments: args } = actions[0]!.command!;
    expect(command).toBe("osv.afterUpdate");

    await server.conn.sendRequest("workspace/executeCommand", { command, arguments: args });
    expect(await server.notification("osv/suggestLockCommand")).toEqual({ cwd: rootDir, command: "npm install" });
  });

  it("osv.update applies the edit through workspace/applyEdit and then suggests the lock command", async () => {
    const { server, rootDir, uri, open } = await setup();
    await open();
    await server.diagnostics(uri);
    const key = (await findingsOf(server, uri))[0]!.key;
    await server.conn.sendRequest("workspace/executeCommand", { command: "osv.update", arguments: [{ uri, key }] });
    expect(server.appliedEdits).toHaveLength(1);
    expect(server.appliedEdits[0]!.changes![uri]![0]!.newText).toBe("4.17.21");
    expect(await server.notification("osv/suggestLockCommand")).toEqual({ cwd: rootDir, command: "npm install" });
  });

  it("keeps diagnostics while the file is temporarily invalid", async () => {
    const { server, uri, open } = await setup();
    await open();
    const before = await server.diagnostics(uri);
    expect(before.length).toBeGreaterThan(0);
    await server.conn.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: '{"dependencies":' }],
    });
    await sleep(1200);
    expect(await server.diagnostics(uri)).toEqual(before);
    expect((await findingsOf(server, uri)).length).toBeGreaterThan(0);
  });

  it("osv.scanWorkspace returns findings for unopened files", async () => {
    const { server, uri, rootDir } = await setup();
    const found = (await server.conn.sendRequest("workspace/executeCommand", { command: "osv.scanWorkspace", arguments: [{}] })) as Finding[];
    expect(found.map((f) => [f.uri, f.name, f.current]).sort()).toEqual(
      [
        [uri, "lodash", "4.17.15"],
        [pathToFileURL(join(rootDir, "package-lock.json")).href, "lodash", "4.17.15"],
      ].sort(),
    );
    expect((await server.diagnostics(uri))[0]).toMatchObject({ code: GHSA });
    expect((await server.diagnostics(pathToFileURL(join(rootDir, "package-lock.json")).href))[0]).toMatchObject({ code: GHSA });
  });

  it("osv.ignore without client support creates osv-scanner.toml", async () => {
    const { server, rootDir } = await setup();
    await server.conn.sendRequest("workspace/executeCommand", { command: "osv.ignore", arguments: [{ id: GHSA }] });
    const tomlUri = pathToFileURL(join(rootDir, "osv-scanner.toml")).href;
    expect(server.appliedEdits).toHaveLength(1);
    const changes = server.appliedEdits[0]!.documentChanges!;
    expect(changes[0]).toMatchObject({ kind: "create", uri: tomlUri });
    const edit = changes[1] as TextDocumentEdit;
    expect(edit.textDocument.uri).toBe(tomlUri);
    expect(edit.edits).toEqual([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: `[[IgnoredVulns]]\nid = "${GHSA}"\n` }]);
    expect(server.notifications.some((n) => n.method === "osv/addIgnore")).toBe(false);
  });

  it("osv.ignore appends to an existing osv-scanner.toml", async () => {
    const { server, rootDir } = await setup();
    writeFileSync(join(rootDir, "osv-scanner.toml"), `# keep\n[[IgnoredVulns]]\nid = "GHSA-old"\n`);
    await server.conn.sendRequest("workspace/executeCommand", { command: "osv.ignore", arguments: [{ id: GHSA }] });
    const tomlUri = pathToFileURL(join(rootDir, "osv-scanner.toml")).href;
    const edits = server.appliedEdits[0]!.changes![tomlUri] as TextEdit[];
    expect(edits).toEqual([
      { range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } }, newText: `\n[[IgnoredVulns]]\nid = "${GHSA}"\n` },
    ]);
  });

  it("osv.ignore with client support sends osv/addIgnore instead of editing", async () => {
    const { server } = await setup({ clientHandlesIgnore: true });
    await server.conn.sendRequest("workspace/executeCommand", { command: "osv.ignore", arguments: [{ id: GHSA }] });
    expect(await server.notification("osv/addIgnore")).toEqual({ id: GHSA });
    expect(server.appliedEdits).toEqual([]);
  });

  it("offline: osv/status offline=true and no crash", async () => {
    const { server, uri, open } = await setup({ fake: "closed" });
    await open();
    expect(await server.notification("osv/status", 20_000)).toEqual({ offline: true });
    expect(await server.diagnostics(uri)).toEqual([]);
    const hover = await server.conn.sendRequest("textDocument/hover", { textDocument: { uri }, position: LODASH_POS });
    expect(hover).toBeNull();
  });

  it("osv.update on a stale finding rescans and does not apply", async () => {
    const { server, uri, open } = await setup({ lockfile: false });
    await open();
    await server.diagnostics(uri);
    const key = (await findingsOf(server, uri))[0]!.key;
    // The edit lands inside the 750 ms debounce window, so the stored finding is out of date.
    await server.conn.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: PACKAGE_JSON.replace("4.17.15", "4.17.21") }],
    });
    await server.conn.sendRequest("workspace/executeCommand", { command: "osv.update", arguments: [{ uri, key }] });
    expect(server.appliedEdits).toEqual([]);
    expect(await server.notification("window/showMessage")).toMatchObject({ message: "lodash is no longer at 4.17.15; the fix was not applied." });
    expect(await findingsOf(server, uri)).toEqual([]);
  });
});
