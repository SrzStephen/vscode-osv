import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { scanDocument, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { packagistModule } from "../../../src/ecosystems/packagist/index.js";

const fixtures = join(__dirname, "..", "..", "fixtures");
const read = (...p: string[]): string => readFileSync(join(fixtures, ...p), "utf8");
const records = (): OsvRecord[] => ["GHSA-25mq-v84q-4j7r", "GHSA-f283-ghqc-fg79"].map((id) => JSON.parse(read("osv", `${id}.json`)) as OsvRecord);

function ctx(files: Record<string, string>, queried: PackageQuery[] = []): ScanContext {
  return {
    files: {
      read: async (p) => files[p],
      list: async (d) => Object.keys(files).filter((f) => f.startsWith(`${d}/`) && !f.slice(d.length + 1).includes("/")).map((f) => f.slice(d.length + 1)),
    },
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) {
          queried.push(q);
          results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "guzzlehttp/guzzle" ? records() : [], cached: false });
        }
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

describe("packagistModule", () => {
  it("is registered and classifies files", () => {
    expect(ALL_MODULES).toContain(packagistModule);
    expect(classifyFile("a/composer.json")).toMatchObject({ role: "manifest" });
    expect(classifyFile("composer.lock")).toMatchObject({ role: "lockfile" });
    expect(classifyFile("composer.json")?.module.id).toBe("packagist");
  });

  it("declares ids and file mappings", () => {
    expect(packagistModule).toMatchObject({ id: "packagist", osvEcosystem: "Packagist", manifests: ["composer.json"], lockfiles: ["composer.lock"] });
    expect(packagistModule.lockfilesForManifest("composer.json")).toEqual(["composer.lock"]);
    expect(packagistModule.manifestForLockfile("composer.lock")).toBe("composer.json");
    expect(packagistModule.normalizeName("Foo/Bar")).toBe("foo/bar");
  });

  it("parses through the module", () => {
    expect(packagistModule.parseManifest(read("packagist", "composer.json"), "composer.json")).toHaveLength(4);
    expect(packagistModule.parseLockfile(read("packagist", "composer.lock"), "composer.lock")).toHaveLength(8);
  });

  it("lock command and transitive fix", () => {
    expect(packagistModule.lockCommand({ manifestPath: "/p/composer.json", name: "guzzlehttp/guzzle", target: "7.15.1" })).toBe("composer update guzzlehttp/guzzle");
    expect(packagistModule.transitiveFix({ name: "psr/log", current: "1.0.0", target: "1.1.4", lockfilePath: "/p/composer.lock" })).toEqual({
      kind: "command-only",
      edit: [],
      lockCommand: { cwd: "/p", command: "composer update psr/log" },
    });
  });

  it("refuses shell-unsafe names", () => {
    expect(packagistModule.lockCommand({ manifestPath: "/p/composer.json", name: "a/b;rm", target: "1" })).toBeUndefined();
    expect(packagistModule.transitiveFix({ name: "a/b;rm", current: "1", target: "2", lockfilePath: "/p/composer.lock" })).toBeUndefined();
  });

  it("refuses names that would read as an option", () => {
    expect(packagistModule.lockCommand({ manifestPath: "/p/composer.json", name: "--all", target: "1" })).toBeUndefined();
    expect(packagistModule.transitiveFix({ name: "--all", current: "1", target: "2", lockfilePath: "/p/composer.lock" })).toBeUndefined();
  });

  it("queries neither platform nor dev requirements, and locks guzzle at 7.4.4", async () => {
    const files = { "/ws/composer.json": read("packagist", "composer.json"), "/ws/composer.lock": read("packagist", "composer.lock") };
    const queried: PackageQuery[] = [];
    await scanDocument("file:///ws/composer.json", "/ws/composer.json", files["/ws/composer.json"], ctx(files, queried));
    const names = queried.map((q) => q.name);
    expect(names).toContain("guzzlehttp/guzzle");
    for (const n of ["php", "ext-json", "acme/edge", "acme/snapshot", "composer-runtime-api"]) expect(names).not.toContain(n);
    expect(queried.find((q) => q.name === "guzzlehttp/guzzle")?.version).toBe("7.4.4");
  });

  it("guzzle ^7.4 with two real records -> 7.15.1", async () => {
    const files = { "/ws/composer.json": '{"require":{"guzzlehttp/guzzle":"^7.4"}}' };
    const r = await scanDocument("file:///ws/composer.json", "/ws/composer.json", files["/ws/composer.json"], ctx(files));
    const f = r.findings.find((x) => x.name === "guzzlehttp/guzzle")!;
    expect(f).toMatchObject({ current: "7.4", checkedLowerBound: true, fix: { target: "7.15.1" } });
    expect(f.vulns.map((v) => v.id).sort()).toEqual(["GHSA-25mq-v84q-4j7r", "GHSA-f283-ghqc-fg79"]);
    expect(f.update?.edit[0]?.newText).toBe("^7.15.1");
  });

  it("uses the locked version when a lockfile exists", async () => {
    const files = { "/ws/composer.json": read("packagist", "composer.json"), "/ws/composer.lock": read("packagist", "composer.lock") };
    const r = await scanDocument("file:///ws/composer.json", "/ws/composer.json", files["/ws/composer.json"], ctx(files));
    expect(r.findings.find((x) => x.name === "guzzlehttp/guzzle")).toMatchObject({ current: "7.4.4", checkedLowerBound: false, fix: { target: "7.15.1" } });
  });
});
