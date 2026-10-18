import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeFileSource } from "../../src/core/fileSource.js";
import { IgnoreMatcher } from "../../src/core/ignores.js";
import type { ScanContext } from "../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../src/core/types.js";
import type { EcosystemModule } from "../../src/ecosystems/types.js";
import { ALL_MODULES } from "../../src/ecosystems/index.js";
import { discoverFiles, scanFiles } from "../../src/core/workspaceScanner.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "osv-ws-")));
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  mkdirSync(join(root, "svc"));
  writeFileSync(join(root, "package.json"), '{"dependencies":{"lodash":"4.17.15"}}');
  writeFileSync(join(root, "node_modules", "x", "package.json"), '{"dependencies":{"evil":"1.0.0"}}');
  writeFileSync(join(root, "svc", "requirements.txt"), "flask==2.0.0\nrequests==2.0.0\n");
  writeFileSync(join(root, "README.md"), "# readme");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("discoverFiles", () => {
  it("returns only manifests and lockfiles, skipping node_modules", async () => {
    const found = await discoverFiles(root, ALL_MODULES);
    expect(found.sort()).toEqual([join(root, "package.json"), join(root, "svc", "requirements.txt")].sort());
  });

  it("skips directories matching exclude globs", async () => {
    const found = await discoverFiles(root, ALL_MODULES, { exclude: ["svc"] });
    expect(found).toEqual([join(root, "package.json")]);
  });

  it("a pattern without a slash excludes that name at any depth", async () => {
    mkdirSync(join(root, "packages", "a", "legacy"), { recursive: true });
    writeFileSync(join(root, "packages", "a", "legacy", "package.json"), "{}");
    const found = await discoverFiles(root, ALL_MODULES, { exclude: ["legacy"] });
    expect(found).not.toContain(join(root, "packages", "a", "legacy", "package.json"));
    expect(found).toHaveLength(2);
  });

  it("an unreadable subdirectory is reported and does not abort discovery", async () => {
    const locked = join(root, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "package.json"), "{}");
    chmodSync(locked, 0o000);
    try {
      const errors: { path: string; message: string }[] = [];
      const found = await discoverFiles(root, ALL_MODULES, { onError: (path, message) => errors.push({ path, message }) });
      expect(found.sort()).toEqual([join(root, "package.json"), join(root, "svc", "requirements.txt")].sort());
      expect(errors.map((e) => e.path)).toEqual([locked]);
      expect(errors[0]!.message).toContain("EACCES");
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it("a pattern with a slash stays anchored to the root", async () => {
    const found = await discoverFiles(root, ALL_MODULES, { exclude: ["svc/**"] });
    expect(found).toEqual([join(root, "package.json")]);
  });
});

describe("scanFiles", () => {
  it("makes one lookup with deduplicated queries across files", async () => {
    // Same package and version in a second npm manifest: it must be queried once.
    writeFileSync(join(root, "svc", "package.json"), '{"dependencies":{"lodash":"4.17.15"}}');
    const calls: PackageQuery[][] = [];
    const ctx: ScanContext = {
      files: nodeFileSource,
      osv: {
        lookup: async (queries: PackageQuery[]) => {
          calls.push(queries);
          return { results: new Map(), offline: true, skipped: [] };
        },
      },
      settings: DEFAULT_SETTINGS,
      ignores: new IgnoreMatcher([], [], new Date()),
      rootDir: root,
    };
    const paths = await discoverFiles(root, ALL_MODULES);
    expect(paths).toHaveLength(3);
    const r = await scanFiles(paths, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((q) => `${q.ecosystem}|${q.name}`).sort()).toEqual(["PyPI|flask", "PyPI|requests", "npm|lodash"]);
    expect(r).toEqual({ findings: [], offline: true, parseErrors: [] });
  });

  it("reports corrupt manifests in parseErrors without throwing", async () => {
    writeFileSync(join(root, "package.json"), "{nope");
    const ctx: ScanContext = {
      files: nodeFileSource,
      osv: { lookup: async () => ({ results: new Map(), offline: false, skipped: [] }) },
      settings: DEFAULT_SETTINGS,
      ignores: new IgnoreMatcher([], [], new Date()),
      rootDir: root,
    };
    const r = await scanFiles([join(root, "package.json"), join(root, "missing", "package.json")], ctx);
    expect(r.parseErrors.map((e) => e.path)).toEqual([join(root, "package.json"), join(root, "missing", "package.json")]);
    expect(r.parseErrors[1]!.message).toBe("unreadable");
  });

  it("a leading BOM does not shift columns (they match the editor, which hides the BOM)", async () => {
    const flask: OsvRecord = {
      id: "GHSA-test-flask",
      modified: "2026-01-01T00:00:00Z",
      affected: [{ package: { ecosystem: "PyPI", name: "flask" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.2.5" }] }] }],
    };
    const ctx: ScanContext = {
      files: nodeFileSource,
      osv: {
        lookup: async (queries: PackageQuery[]) => ({
          results: new Map(queries.map((q) => [`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "flask" ? [flask] : [], cached: false }])),
          offline: false,
          skipped: [],
        }),
      },
      settings: DEFAULT_SETTINGS,
      ignores: new IgnoreMatcher([], [], new Date()),
      rootDir: root,
    };
    const path = join(root, "svc", "requirements.txt");
    const plain = await scanFiles([path], ctx);
    writeFileSync(path, "﻿flask==2.0.0\nrequests==2.0.0\n");
    expect(await nodeFileSource.read(path)).toBe("flask==2.0.0\nrequests==2.0.0\n");
    const bom = await scanFiles([path], ctx);
    expect(plain.findings).toHaveLength(1);
    expect(bom.findings.map((f) => f.range)).toEqual(plain.findings.map((f) => f.range));
    expect(bom.findings[0]!.range.start).toEqual({ line: 0, character: 5 });
  });

  it("a module that throws is isolated to its file; other files still yield findings", async () => {
    const npm = ALL_MODULES.find((m) => m.id === "npm")!;
    const broken: EcosystemModule = {
      ...npm,
      id: "broken",
      manifests: ["boom.json"],
      lockfiles: [],
      parseManifest: () => {
        throw new TypeError("module bug");
      },
    };
    writeFileSync(join(root, "boom.json"), "{}");
    const lodash: OsvRecord = {
      id: "GHSA-test-lodash",
      modified: "2026-01-01T00:00:00Z",
      affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }],
    };
    const ctx: ScanContext = {
      files: nodeFileSource,
      osv: {
        lookup: async (queries: PackageQuery[]) => ({
          results: new Map(queries.map((q) => [`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "lodash" ? [lodash] : [], cached: false }])),
          offline: false,
          skipped: [],
        }),
      },
      settings: DEFAULT_SETTINGS,
      ignores: new IgnoreMatcher([], [], new Date()),
      rootDir: root,
      modules: [broken, ...ALL_MODULES],
    };
    const r = await scanFiles([join(root, "boom.json"), join(root, "package.json")], ctx);
    expect(r.parseErrors).toEqual([{ path: join(root, "boom.json"), message: "module bug" }]);
    expect(r.findings.map((f) => `${f.name}@${f.current}`)).toEqual(["lodash@4.17.15"]);
  });
});
