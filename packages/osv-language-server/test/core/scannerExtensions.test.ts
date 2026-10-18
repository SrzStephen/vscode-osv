import { describe, expect, it } from "vitest";
import type { FileSource } from "../../src/core/fileSource.js";
import { IgnoreMatcher } from "../../src/core/ignores.js";
import { findManifestForLockfile } from "../../src/core/lockfileResolver.js";
import { scanDocument, type ScanContext } from "../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../src/core/settings.js";
import type { DeclaredDep, OsvRecord, PackageQuery, ResolvedDep, TextRange } from "../../src/core/types.js";
import type { EcosystemModule } from "../../src/ecosystems/types.js";
import { npmModule } from "../../src/ecosystems/npm/index.js";

const r = (line: number, a: number, b: number): TextRange => ({ start: { line, character: a }, end: { line, character: b } });

const record = (name: string): OsvRecord => ({
  id: "GHSA-fake-0001-aaaa",
  modified: "2026-01-01T00:00:00Z",
  database_specific: { severity: "HIGH" },
  affected: [{ package: { ecosystem: "Fake", name }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "2.0.0" }] }] }],
});

/** Manifest lines are "name [spec]"; lock lines are "name version". */
function fakeModule(over: Partial<EcosystemModule> = {}): EcosystemModule {
  return {
    ...npmModule,
    id: "fake",
    osvEcosystem: "Fake",
    manifests: ["deps.txt"],
    lockfiles: ["deps.lock"],
    lockfilesForManifest: () => ["deps.lock"],
    manifestForLockfile: () => "deps.txt",
    parseManifest: (text) =>
      text
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l, i): DeclaredDep => {
          const [name = "", spec] = l.split(" ");
          return {
            name,
            nameRange: r(i, 0, name.length),
            ...(spec !== undefined ? { rawSpec: spec, lowerBound: spec, specRange: r(i, name.length + 1, l.length) } : {}),
            kind: "registry",
          };
        }),
    parseLockfile: (text) =>
      text
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l, i): ResolvedDep => {
          const [name = "", version = ""] = l.split(" ");
          return { name, version, range: r(i, 0, l.length), direct: true };
        }),
    rewriteSpec: (_raw, target) => ({ spec: target, widened: false }),
    lockCommand: () => undefined,
    transitiveFix: () => undefined,
    ...over,
  };
}

function ctx(mod: EcosystemModule, files: Record<string, string>, seen: PackageQuery[] = []): ScanContext {
  return {
    files: { read: async (p) => files[p], list: async () => [] },
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        seen.push(...queries);
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: [record(q.name)], cached: false });
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
    modules: [mod],
  };
}

describe("scanner contract extensions", () => {
  it("edits specLocation instead of the declaration", async () => {
    const mod = fakeModule({
      resolveExternal: async (deps) =>
        deps.map((d) => ({ ...d, rawSpec: "1.0.0", lowerBound: "1.0.0", specLocation: { path: "/ws/versions.txt", range: r(3, 4, 9), rawSpec: "1.0.0" } })),
    });
    const res = await scanDocument("file:///ws/deps.txt", "/ws/deps.txt", "foo\n", ctx(mod, {}));
    expect(res.findings).toHaveLength(1);
    const f = res.findings[0]!;
    expect(f.range).toEqual(r(0, 0, 3));
    expect(f.uri).toBe("file:///ws/deps.txt");
    expect(f.update?.edit).toEqual([{ uri: "file:///ws/versions.txt", range: r(3, 4, 9), newText: "2.0.0" }]);
  });

  it("manifestIsExact skips lockfile lookup and checkedLowerBound=false", async () => {
    const mod = fakeModule({ manifestIsExact: true });
    const res = await scanDocument("file:///ws/deps.txt", "/ws/deps.txt", "foo 1.0.0\n", ctx(mod, { "/ws/deps.lock": "foo 1.5.0\n" }));
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toMatchObject({ current: "1.0.0", checkedLowerBound: false });
  });

  it("nameKey matches case-insensitively and queries with the lockfile casing", async () => {
    const mod = fakeModule({ nameKey: (n) => n.toLowerCase() });
    const seen: PackageQuery[] = [];
    const res = await scanDocument("file:///ws/deps.txt", "/ws/deps.txt", "newtonsoft.json 1.0.0\n", ctx(mod, { "/ws/deps.lock": "Newtonsoft.Json 1.2.0\n" }, seen));
    expect(seen).toEqual([{ ecosystem: "Fake", name: "Newtonsoft.Json", version: "1.2.0" }]);
    expect(res.findings[0]).toMatchObject({ name: "Newtonsoft.Json", current: "1.2.0", checkedLowerBound: false });
  });

  it("manifestsForLockfile expands *.csproj in the lockfile directory", async () => {
    const mod = fakeModule({ manifestsForLockfile: () => ["Missing.props", "*.csproj"] });
    const files: Record<string, string> = { "/ws/b.csproj": "B", "/ws/a.csproj": "A" };
    const source: FileSource = { read: async (p) => files[p], list: async () => ["b.csproj", "a.csproj", "x.txt"] };
    expect(await findManifestForLockfile("/ws/packages.lock.json", mod, source)).toEqual({ path: "/ws/a.csproj", text: "A" });
  });

  it("lockfile findings also edit specLocation after resolveExternal", async () => {
    const mod = fakeModule({
      resolveExternal: async (deps) =>
        deps.map((d) => ({ ...d, rawSpec: "1.0.0", lowerBound: "1.0.0", specLocation: { path: "/ws/versions.txt", range: r(3, 4, 9), rawSpec: "1.0.0" } })),
    });
    const res = await scanDocument("file:///ws/deps.lock", "/ws/deps.lock", "foo 1.0.0\n", ctx(mod, { "/ws/deps.txt": "foo\n" }));
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]!.update?.edit).toEqual([{ uri: "file:///ws/versions.txt", range: r(3, 4, 9), newText: "2.0.0" }]);
  });

  it("anchors a same-file specLocation (path \"\") to the manifest", async () => {
    const base = fakeModule();
    const mod = fakeModule({
      parseManifest: (t, n) =>
        base.parseManifest(t, n).map((d) => ({ ...d, rawSpec: "1.0.0", lowerBound: "1.0.0", specLocation: { path: "", range: r(5, 1, 6), rawSpec: "1.0.0" } })),
    });
    const res = await scanDocument("file:///ws/deps.txt", "/ws/deps.txt", "foo\n", ctx(mod, {}));
    expect(res.findings[0]!.update?.edit).toEqual([{ uri: "file:///ws/deps.txt", range: r(5, 1, 6), newText: "2.0.0" }]);
  });

  it("passes current to transitiveFix", async () => {
    let got: string | undefined;
    const base = fakeModule();
    const mod = fakeModule({
      parseLockfile: (t, n) => base.parseLockfile(t, n).map((e) => ({ ...e, direct: false })),
      transitiveFix: (c) => {
        got = c.current;
        return undefined;
      },
    });
    await scanDocument("file:///ws/deps.lock", "/ws/deps.lock", "foo 1.0.0\n", ctx(mod, {}));
    expect(got).toBe("1.0.0");
  });
});
