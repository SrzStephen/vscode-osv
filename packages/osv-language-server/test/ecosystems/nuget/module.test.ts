import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { scanDocument as scanDocumentNative, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { nugetModule } from "../../../src/ecosystems/nuget/index.js";
import { memFs, posixResult } from "../../helpers/memFs.js";

// Findings carry native paths and file URIs; compare them in POSIX form on every platform.
const scanDocument = posixResult(scanDocumentNative);

const fixtures = join(__dirname, "..", "..", "fixtures");
const read = (...p: string[]): string => readFileSync(join(fixtures, ...p), "utf8");
const record = (): OsvRecord => JSON.parse(read("osv", "GHSA-5crp-9r3c-p9vr.json")) as OsvRecord;

function ctx(files: Record<string, string>, seen: PackageQuery[] = [], exactCase = true): ScanContext {
  return {
    files: memFs(files),
    osv: {
      // The registry is case-sensitive: only the canonical name has records.
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) {
          seen.push(q);
          results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: (exactCase ? q.name === "Newtonsoft.Json" : q.name.toLowerCase() === "newtonsoft.json") ? [record()] : [], cached: false });
        }
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

describe("nugetModule", () => {
  it("is registered and classifies manifests and the lockfile", () => {
    expect(ALL_MODULES).toContain(nugetModule);
    for (const p of ["a.csproj", "x/a.fsproj", "a.vbproj", "Directory.Packages.props", "x/Directory.Build.props", "packages.config"]) {
      expect(classifyFile(p)).toMatchObject({ role: "manifest" });
      expect(classifyFile(p)?.module.id).toBe("nuget");
    }
    expect(classifyFile("app/packages.lock.json")).toMatchObject({ role: "lockfile" });
  });

  it("declares ids, lockfile mapping, names and commands", () => {
    expect(nugetModule).toMatchObject({ id: "nuget", osvEcosystem: "NuGet" });
    expect(nugetModule.manifests).toEqual(["*.csproj", "*.fsproj", "*.vbproj", "Directory.Packages.props", "Directory.Build.props", "packages.config"]);
    expect(nugetModule.lockfiles).toEqual(["packages.lock.json"]);
    for (const m of ["a.csproj", "a.fsproj", "a.vbproj", "packages.config"]) expect(nugetModule.lockfilesForManifest(m)).toEqual(["packages.lock.json"]);
    for (const m of ["Directory.Packages.props", "Directory.Build.props"]) expect(nugetModule.lockfilesForManifest(m)).toEqual([]);
    expect(nugetModule.manifestForLockfile("packages.lock.json")).toBeUndefined();
    expect(nugetModule.manifestsForLockfile?.("packages.lock.json")).toEqual(["*.csproj", "*.fsproj", "*.vbproj"]);
    expect(nugetModule.relatedFiles).toEqual(["Directory.Packages.props", "Directory.Build.props"]);
    expect(nugetModule.normalizeName("Newtonsoft.Json")).toBe("Newtonsoft.Json");
    expect(nugetModule.nameKey?.("Newtonsoft.Json")).toBe("newtonsoft.json");
    expect(nugetModule.versioning.compare("1.10", "1.9")).toBeGreaterThan(0);
    expect(nugetModule.rewriteSpec("12.0.3", "13.0.1")).toEqual({ spec: "13.0.1", widened: false });
    const base = { manifestPath: "/ws/a.csproj", name: "X", target: "1.0" };
    expect(nugetModule.lockCommand({ ...base, lockfilePath: "/ws/packages.lock.json" })).toBe("dotnet restore --force-evaluate");
    expect(nugetModule.lockCommand(base)).toBe("dotnet restore");
    expect(nugetModule.transitiveFix({ name: "X", current: "1", target: "2", lockfilePath: "/ws/packages.lock.json" })).toBeUndefined();
  });

  it("parseManifest dispatches by file name", () => {
    expect(nugetModule.parseManifest(read("nuget", "packages.config"), "packages.config")).toHaveLength(2);
    expect(nugetModule.parseManifest(read("nuget", "app.csproj"), "app.csproj").length).toBeGreaterThan(0);
    expect(nugetModule.parseManifest(read("nuget", "cpm", "Directory.Packages.props"), "Directory.Packages.props")).toHaveLength(3);
  });

  describe("scanDocument", () => {
    it("queries with lockfile casing", async () => {
      const files = { "/ws/app.csproj": read("nuget", "app.csproj"), "/ws/packages.lock.json": read("nuget", "packages.lock.json") };
      const seen: PackageQuery[] = [];
      const r = await scanDocument("file:///ws/app.csproj", "/ws/app.csproj", files["/ws/app.csproj"], ctx(files, seen));
      expect(seen).toContainEqual({ ecosystem: "NuGet", name: "Newtonsoft.Json", version: "12.0.3" });
      expect(seen.some((q) => q.name === "newtonsoft.json")).toBe(false);
      const f = r.findings.find((x) => x.name === "Newtonsoft.Json")!;
      expect(f).toMatchObject({ current: "12.0.3", checkedLowerBound: false, fix: { target: "13.0.1", crossesMajor: true } });
    });

    it("without a lockfile the declared casing is queried at its lower bound", async () => {
      const files = { "/ws/app.csproj": read("nuget", "app.csproj") };
      const seen: PackageQuery[] = [];
      const r = await scanDocument("file:///ws/app.csproj", "/ws/app.csproj", files["/ws/app.csproj"], ctx(files, seen));
      expect(seen).toContainEqual({ ecosystem: "NuGet", name: "newtonsoft.json", version: "12.0.3" });
      expect(r.findings).toHaveLength(0);
    });

    it("one finding per distinct version across target frameworks", async () => {
      const files = { "/ws/packages.lock.json": read("nuget", "packages.lock.json"), "/ws/app.csproj": read("nuget", "app.csproj") };
      const r = await scanDocument("file:///ws/packages.lock.json", "/ws/packages.lock.json", files["/ws/packages.lock.json"], ctx(files));
      expect(r.findings.filter((f) => f.name === "Newtonsoft.Json")).toHaveLength(1);
    });

    it("central package management: a finding on the props file edit", async () => {
      const files = {
        "/ws/cpm/Directory.Packages.props": read("nuget", "cpm", "Directory.Packages.props"),
        "/ws/cpm/src/app/app.csproj": read("nuget", "cpm", "src", "app", "app.csproj"),
      };
      const path = "/ws/cpm/src/app/app.csproj";
      const r = await scanDocument(`file://${path}`, path, files[path], ctx(files, [], false));
      const f = r.findings.find((x) => x.name === "newtonsoft.json")!;
      expect(f).toMatchObject({ current: "12.0.3", fix: { target: "13.0.1" } });
      expect(f.update!.edit[0]!.uri).toBe("file:///ws/cpm/Directory.Packages.props");
      expect(f.update!.edit[0]!.newText).toBe("13.0.1");
    });
  });
});
