import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../src/core/ignores.js";
import { findingKey } from "../../src/core/findingKey.js";
import { scanDocument, type ScanContext } from "../../src/core/scanner.js";
import { DEFAULT_SETTINGS, type Settings } from "../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../src/core/types.js";

const fixture = (id: string): OsvRecord => JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "osv", `${id}.json`), "utf8")) as OsvRecord;
const lodashRecords = (): OsvRecord[] => ["GHSA-35jh-r3h4-6jhm", "GHSA-29mw-wpgm-hmr9", "GHSA-p6mc-m468-83gw"].map(fixture);
const qsRecord: OsvRecord = {
  id: "GHSA-hrpp-h998-j3pp",
  modified: "2026-01-01T00:00:00Z",
  database_specific: { severity: "HIGH" },
  affected: [{ package: { ecosystem: "npm", name: "qs" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "6.7.3" }] }] }],
};

const lockWithLodash = (version: string, extra: Record<string, unknown> = {}, rootExtra: Record<string, string> = {}): string =>
  JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { lodash: `^${version}`, ...rootExtra } }, "node_modules/lodash": { version }, ...extra } });

interface CtxOpts {
  settings?: Partial<Settings>;
  ignored?: string[];
  offline?: boolean;
}

function ctx(files: Record<string, string> = {}, opts: CtxOpts = {}): ScanContext {
  return {
    files: { read: async (p) => files[p] },
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) {
          const records = q.name === "lodash" ? lodashRecords() : q.name === "qs" ? [qsRecord] : [];
          results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records, cached: opts.offline === true });
        }
        return { results, offline: opts.offline === true, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    ignores: new IgnoreMatcher(opts.ignored ?? [], [], new Date()),
    rootDir: "/ws",
  };
}

const pkgJson = '{"dependencies":{"lodash":"^4.17.15"}}';
const uri = "file:///ws/package.json";

describe("scanDocument", () => {
  it("manifest resolved via lockfile, update edit preserves caret", async () => {
    const r = await scanDocument(uri, "/ws/package.json", pkgJson, ctx({ "/ws/package-lock.json": lockWithLodash("4.17.15") }));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      name: "lodash",
      current: "4.17.15",
      checkedLowerBound: false,
      source: "manifest",
      direct: true,
      fix: { target: "4.17.21" },
      update: { kind: "direct", lockCommand: { cwd: "/ws", command: "npm install" } },
    });
    expect(r.findings[0]!.update!.edit[0]!.newText).toBe("^4.17.21");
    expect(r.findings[0]!.update!.edit[0]!.uri).toBe(uri);
    expect(r.findings[0]!.key).toBe(findingKey(r.findings[0]!));
    expect(r.offline).toBe(false);
    expect(r.parseError).toBe(false);
  });

  it("no lockfile uses the lower bound and flags it", async () => {
    const r = await scanDocument(uri, "/ws/package.json", pkgJson, ctx());
    expect(r.findings[0]).toMatchObject({ current: "4.17.15", checkedLowerBound: true, update: { kind: "direct", lockCommand: { cwd: "/ws" } } });
  });

  it("an unparseable lockfile is treated as no lockfile", async () => {
    const r = await scanDocument(uri, "/ws/package.json", pkgJson, ctx({ "/ws/package-lock.json": "{nope" }));
    expect(r.parseError).toBe(false);
    expect(r.findings[0]).toMatchObject({ checkedLowerBound: true });
  });

  it("lockfile direct finding edits the manifest declaration", async () => {
    const files = { "/ws/package.json": pkgJson };
    const r = await scanDocument("file:///ws/package-lock.json", "/ws/package-lock.json", lockWithLodash("4.17.15"), ctx(files));
    expect(r.findings[0]).toMatchObject({ source: "lockfile", direct: true, checkedLowerBound: false, update: { kind: "direct" } });
    expect(r.findings[0]!.update!.edit[0]).toMatchObject({ uri, newText: "^4.17.21" });
  });

  it("lockfile transitive finding has via and override plan", async () => {
    const manifest = '{"dependencies":{"lodash":"^4.17.15","express":"4.17.1"}}';
    const lock = lockWithLodash("4.17.15", {
      "node_modules/express": { version: "4.17.1", dependencies: { qs: "6.7.0" } },
      "node_modules/qs": { version: "6.7.0" },
    }, { express: "4.17.1" });
    const r = await scanDocument("file:///ws/package-lock.json", "/ws/package-lock.json", lock, ctx({ "/ws/package.json": manifest }));
    const qs = r.findings.find((f) => f.name === "qs")!;
    expect(qs).toMatchObject({ direct: false, via: ["express"], fix: { target: "6.7.3" }, update: { kind: "override" } });
    expect(qs.update!.edit[0]!.newText).toContain("6.7.3");
    expect(qs.update!.edit[0]!.uri).toBe(uri);
  });

  it("ignored and below-threshold vulns are removed; empty findings dropped", async () => {
    const files = { "/ws/package-lock.json": lockWithLodash("4.17.15") };
    const some = await scanDocument(uri, "/ws/package.json", pkgJson, ctx(files, { ignored: ["GHSA-35jh-r3h4-6jhm"] }));
    expect(some.findings[0]!.vulns.map((v) => v.id)).not.toContain("GHSA-35jh-r3h4-6jhm");
    expect(some.findings[0]!.vulns).toHaveLength(2);
    expect(some.findings[0]!.fix.target).toBe("4.17.21");

    const high = await scanDocument(uri, "/ws/package.json", pkgJson, ctx(files, { settings: { minimumSeverity: "high" } }));
    expect(high.findings[0]!.vulns.length).toBeGreaterThan(0);
    expect(high.findings[0]!.vulns.length).toBeLessThan(3);
    expect(high.findings[0]!.vulns.every((v) => v.severity === "high" || v.severity === "critical")).toBe(true);

    const none = await scanDocument(uri, "/ws/package.json", pkgJson, ctx(files, { ignored: ["CVE-2021-23337", "CVE-2020-28500", "CVE-2020-8203"] }));
    expect(none.findings).toEqual([]);
  });

  it("parse error reported, no throw", async () => {
    const r = await scanDocument(uri, "/ws/package.json", '{"dependencies":', ctx());
    expect(r).toEqual({ findings: [], offline: false, parseError: true });
  });

  it("non-matching file gives an empty result", async () => {
    const r = await scanDocument("file:///ws/readme.md", "/ws/readme.md", "# hi", ctx());
    expect(r).toEqual({ findings: [], offline: false, parseError: false });
  });

  it("files under node_modules are never scanned", async () => {
    const r = await scanDocument("file:///ws/node_modules/x/package.json", "/ws/node_modules/x/package.json", pkgJson, ctx());
    expect(r.findings).toEqual([]);
  });

  it("disabled ecosystem, disabled extension and skipped lockfiles give empty results", async () => {
    expect((await scanDocument(uri, "/ws/package.json", pkgJson, ctx({}, { settings: { ecosystems: { npm: false } } }))).findings).toEqual([]);
    expect((await scanDocument(uri, "/ws/package.json", pkgJson, ctx({}, { settings: { enable: false } }))).findings).toEqual([]);
    const l = await scanDocument("file:///ws/package-lock.json", "/ws/package-lock.json", lockWithLodash("4.17.15"), ctx({ "/ws/package.json": pkgJson }, { settings: { scanLockfiles: false } }));
    expect(l.findings).toEqual([]);
  });

  it("reports offline and cached from the lookup", async () => {
    const r = await scanDocument(uri, "/ws/package.json", pkgJson, ctx({}, { offline: true }));
    expect(r.offline).toBe(true);
    expect(r.findings[0]!.cached).toBe(true);
  });
});

describe("findingKey", () => {
  it("joins source, ecosystem, name, version and start position", () => {
    const range = { start: { line: 3, character: 7 }, end: { line: 3, character: 9 } };
    expect(findingKey({ source: "manifest", ecosystem: "npm", name: "a", current: "1.0.0", range })).toBe("manifest:npm:a@1.0.0:3:7");
  });
});
