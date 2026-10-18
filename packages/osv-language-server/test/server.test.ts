import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

  it("sends the osv-language-server/<version> User-Agent", async () => {
    const fake = await startFakeOsv({ packages: { "npm|lodash|4.17.15": [GHSA] }, records: { [GHSA]: record } });
    cleanups.push(() => fake.close());
    const { server, uri, open } = await setup({ fake });
    await open();
    await server.diagnostics(uri);
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const r of fake.requests) expect(r.userAgent).toMatch(/^osv-language-server\/\d+\.\d+\.\d+/);
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

  it("osv.scanWorkspace applies each file's nearest osv-scanner.toml", async () => {
    const { server, uri, rootDir } = await setup({ lockfile: false });
    mkdirSync(join(rootDir, "sub"));
    writeFileSync(join(rootDir, "sub", "package.json"), PACKAGE_JSON);
    writeFileSync(join(rootDir, "sub", "osv-scanner.toml"), `[[IgnoredVulns]]\nid = "${GHSA}"\n`);
    const found = (await server.conn.sendRequest("workspace/executeCommand", { command: "osv.scanWorkspace", arguments: [{}] })) as Finding[];
    expect(found.map((f) => f.uri)).toEqual([uri]);
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

  it("offline: a parse error does not clear the offline status", async () => {
    const { server, uri, open } = await setup({ fake: "closed" });
    await open();
    expect(await server.notification("osv/status", 20_000)).toEqual({ offline: true });
    await server.conn.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: '{"dependencies":' }],
    });
    await sleep(2_000); // past the 750 ms debounce; a parse error publishes nothing to wait on
    expect(server.notifications.filter((n) => n.method === "osv/status").map((n) => n.params)).toEqual([{ offline: true }]);
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

  it("a malformed file: URI does not crash the server", async () => {
    const { server, uri, open } = await setup();
    const bad = "file:///a%2Fb/package.json";
    await server.conn.sendNotification("textDocument/didOpen", { textDocument: { uri: bad, languageId: "json", version: 1, text: PACKAGE_JSON } });
    await open();
    expect((await server.diagnostics(uri))[0]).toMatchObject({ code: GHSA });
  });

  it("hover and code action failures return a normal response", async () => {
    const { server, uri, open } = await setup();
    await open();
    await server.diagnostics(uri);
    // A null position/range makes the feature code throw for a document that has findings.
    expect(await server.conn.sendRequest("textDocument/hover", { textDocument: { uri }, position: null })).toBeNull();
    expect(await server.conn.sendRequest("textDocument/codeAction", { textDocument: { uri }, range: null, context: { diagnostics: [] } })).toEqual([]);
    expect(await server.conn.sendRequest("textDocument/hover", { textDocument: { uri }, position: LODASH_POS })).not.toBeNull();
  });

  it("a workspace scan does not overwrite a newer open-document scan", async () => {
    const fake = await startFakeOsv({ packages: { "npm|lodash|4.17.15": [GHSA] }, records: { [GHSA]: record } }, { batchDelayMs: 1000 });
    cleanups.push(() => fake.close());
    const { server, uri, open } = await setup({ lockfile: false, fake });
    await open();
    const scan = server.conn.sendRequest("workspace/executeCommand", { command: "osv.scanWorkspace", arguments: [{}] }) as Promise<Finding[]>;
    await sleep(300);
    await server.conn.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: PACKAGE_JSON.replace("4.17.15", "4.17.21") }],
    });
    const key = (await scan).find((f) => f.uri === uri)!.key;
    // The workspace scan read version 1; it must not mark the stored findings as current for version 2.
    await server.conn.sendRequest("workspace/executeCommand", { command: "osv.update", arguments: [{ uri, key }] });
    expect(server.appliedEdits).toEqual([]);
  });
});

describe("language server: Phase 2 ecosystems", { timeout: 30_000 }, () => {
  const rec = (id: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "osv", `${id}.json`), "utf8")) as OsvRecord;
  const LOG4J = ["GHSA-jfh8-c2jp-5v3q", "GHSA-7rjr-3q55-vv33", "GHSA-p6xc-xr62-6r2g", "GHSA-8489-44mv-ggj8"];

  async function open(files: Record<string, string>, openPath: string, key: string, ids: string[]) {
    const rootDir = tmp("osv-ws-");
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(rootDir, rel)), { recursive: true });
      writeFileSync(join(rootDir, rel), text);
    }
    const fake = await startFakeOsv({ packages: { [key]: ids }, records: Object.fromEntries(ids.map((id) => [id, rec(id)])) });
    cleanups.push(() => fake.close());
    const server = await startTestServer({ osvUrl: fake.url, cacheDir: tmp("osv-cache-"), rootDir, clientHandlesIgnore: false });
    cleanups.push(() => server.stop());
    const uri = pathToFileURL(join(rootDir, openPath)).href;
    await server.conn.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "plaintext", version: 1, text: files[openPath]! } });
    const diagnostics = await server.diagnostics(uri);
    const [finding] = await findingsOf(server, uri);
    const pos = finding!.range.start;
    const actions = (await server.conn.sendRequest("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: pos, end: pos },
      context: { diagnostics: [] },
    })) as CodeAction[];
    return { rootDir, uri, diagnostics, actions };
  }
  const editsOf = (a: CodeAction) => (a.edit as WorkspaceEdit).changes!;

  it("Cargo.toml: publishes diagnostics and offers the version edit", async () => {
    const text = `[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\nsmallvec = "0.6.9"\n`;
    const r = await open({ "Cargo.toml": text }, "Cargo.toml", "crates.io|smallvec|0.6.9", ["GHSA-43w2-9j62-hq99", "GHSA-66p5-j55p-32r9"]);
    expect(r.diagnostics[0]).toMatchObject({ source: "osv" });
    expect(r.actions).toHaveLength(1);
    expect(editsOf(r.actions[0]!)[r.uri]![0]!.newText).toBe("0.6.14");
  });

  it("pom.xml: a property-defined version edits the <properties> value", async () => {
    const text = readFileSync(join(__dirname, "fixtures", "repos", "maven", "pom.xml"), "utf8");
    const r = await open({ "pom.xml": text }, "pom.xml", "Maven|org.apache.logging.log4j:log4j-core|2.14.1", LOG4J);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.actions).toHaveLength(1);
    const edit = editsOf(r.actions[0]!)[r.uri]![0]!;
    expect(edit.newText).toBe("2.17.1");
    // The edit lands on line 7 (`<log4j.version>2.14.1</log4j.version>`), not on the ${log4j.version} reference.
    expect(edit.range.start.line).toBe(7);
  });

  it("a gradle/libs.versions.toml change rescans open build files in the parent tree", async () => {
    const rootDir = tmp("osv-ws-");
    const catalog = (v: string) => `[libraries]\nlog4j-core = "org.apache.logging.log4j:log4j-core:${v}"\n`;
    const build = `dependencies {\n    implementation(libs.log4j.core)\n}\n`;
    mkdirSync(join(rootDir, "gradle"));
    mkdirSync(join(rootDir, "app"));
    writeFileSync(join(rootDir, "gradle", "libs.versions.toml"), catalog("2.17.1"));
    writeFileSync(join(rootDir, "build.gradle.kts"), build);
    writeFileSync(join(rootDir, "app", "build.gradle.kts"), build);
    const fake = await startFakeOsv({ packages: { "Maven|org.apache.logging.log4j:log4j-core|2.14.1": LOG4J }, records: Object.fromEntries(LOG4J.map((id) => [id, rec(id)])) });
    cleanups.push(() => fake.close());
    const server = await startTestServer({ osvUrl: fake.url, cacheDir: tmp("osv-cache-"), rootDir, clientHandlesIgnore: false });
    cleanups.push(() => server.stop());
    const uris = ["build.gradle.kts", join("app", "build.gradle.kts")].map((p) => pathToFileURL(join(rootDir, p)).href);
    for (const uri of uris) {
      await server.conn.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "plaintext", version: 1, text: build } });
      expect(await server.diagnostics(uri)).toEqual([]);
    }

    writeFileSync(join(rootDir, "gradle", "libs.versions.toml"), catalog("2.14.1"));
    await server.conn.sendNotification("workspace/didChangeWatchedFiles", {
      changes: [{ uri: pathToFileURL(join(rootDir, "gradle", "libs.versions.toml")).href, type: 2 }],
    });
    for (const uri of uris) {
      let diagnostics = await server.diagnostics(uri);
      for (let i = 0; i < 50 && diagnostics.length === 0; i++) {
        await sleep(100);
        diagnostics = await server.diagnostics(uri);
      }
      expect(diagnostics.length, uri).toBeGreaterThan(0);
    }
  });

  it("go.mod: publishes diagnostics and offers the version edit", async () => {
    const text = readFileSync(join(__dirname, "fixtures", "repos", "go", "go.mod"), "utf8");
    const r = await open({ "go.mod": text }, "go.mod", "Go|golang.org/x/text|v0.3.5", ["GO-2021-0113", "GO-2022-1059"]);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(editsOf(r.actions[0]!)[r.uri]![0]!.newText).toBe("v0.3.8");
  });

  it("*.csproj with central package management: the edit targets Directory.Packages.props", async () => {
    const props = `<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageVersion Include="Newtonsoft.Json" Version="12.0.3" />\n  </ItemGroup>\n</Project>\n`;
    const csproj = `<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Newtonsoft.Json" />\n  </ItemGroup>\n</Project>\n`;
    const r = await open({ "Directory.Packages.props": props, "src/app/app.csproj": csproj }, "src/app/app.csproj", "NuGet|Newtonsoft.Json|12.0.3", ["GHSA-5crp-9r3c-p9vr"]);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.actions).toHaveLength(1);
    const changes = editsOf(r.actions[0]!);
    const propsUri = pathToFileURL(join(r.rootDir, "Directory.Packages.props")).href;
    expect(Object.keys(changes)).toEqual([propsUri]);
    expect(changes[propsUri]![0]!.newText).toBe("13.0.1");
  });
});
