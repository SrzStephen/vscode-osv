import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { scanDocument as scanDocumentNative, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { swiftModule } from "../../../src/ecosystems/swift/index.js";
import { memFs, posixResult } from "../../helpers/memFs.js";

// Findings carry native paths and file URIs; compare them in POSIX form on every platform.
const scanDocument = posixResult(scanDocumentNative);

const fixtures = join(__dirname, "..", "..", "fixtures");
const read = (...p: string[]): string => readFileSync(join(fixtures, ...p), "utf8");
const IDS = ["GHSA-cq87-8r7h-962v", "GHSA-r3rc-9hpw-54v9", "GHSA-rj37-6j9x-74q6"];
const records = (): OsvRecord[] => IDS.map((id) => JSON.parse(read("osv", `${id}.json`)) as OsvRecord);

function ctx(files: Record<string, string>): ScanContext {
  return {
    files: memFs(files),
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "github.com/apple/swift-nio" ? records() : [], cached: false });
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

describe("swiftModule", () => {
  it("is registered and classifies files", () => {
    expect(ALL_MODULES).toContain(swiftModule);
    expect(classifyFile("app/Package.swift")).toMatchObject({ role: "manifest" });
    expect(classifyFile("Package.resolved")).toMatchObject({ role: "lockfile" });
    expect(classifyFile("Package.swift")?.module.id).toBe("swift");
  });

  it("declares ids, mappings and name handling", () => {
    expect(swiftModule).toMatchObject({ id: "swift", osvEcosystem: "SwiftURL", manifests: ["Package.swift"], lockfiles: ["Package.resolved"] });
    expect(swiftModule.lockfilesForManifest("Package.swift")).toEqual(["Package.resolved"]);
    expect(swiftModule.manifestForLockfile("Package.resolved")).toBe("Package.swift");
    expect(swiftModule.normalizeName("https://github.com/apple/swift-nio.git")).toBe("github.com/apple/swift-nio");
    expect(swiftModule.normalizeName("weird")).toBe("weird");
    expect(swiftModule.nameKey?.("github.com/Apple/Swift-NIO")).toBe("github.com/apple/swift-nio");
    expect(swiftModule.lockCommand({ manifestPath: "/p/Package.swift", name: "x", target: "1.0.0" })).toBe("swift package update");
    expect(swiftModule.transitiveFix({ name: "x", current: "1.0.0", target: "1.1.0", lockfilePath: "/p/Package.resolved" })).toBeUndefined();
  });

  it.each([
    ["2.29.0", "2.100.0", "2.100.0", false],
    ['"2.0.0"..<"2.50.0"', "2.100.0", '"2.100.0"..<"3.0.0"', true],
    ['"2.0.0"..<"3.0.0"', "2.100.0", '"2.100.0"..<"3.0.0"', false],
    ['"2.0.0"..."2.50.0"', "2.100.0", '"2.100.0"..."3.0.0"', true],
    ['"2.0.0"..."2.100.0"', "2.100.0", '"2.100.0"..."2.100.0"', false],
    ['"1.0.0" ..< "2.0.0"', "2.1.0", '"2.1.0" ..< "3.0.0"', true],
    ['"1.0.0"..<"2.0.0"', "2.0.0", '"2.0.0"..<"3.0.0"', true],
  ])("rewrite %s -> %s", (raw, t, spec, w) => expect(swiftModule.rewriteSpec(raw, t)).toEqual({ spec, widened: w }));

  it("swift-nio 2.29.0 -> 2.100.0", async () => {
    const path = "/ws/Package.swift";
    const files = { [path]: read("swift", "Package.swift") };
    const r = await scanDocument(`file://${path}`, path, files[path], ctx(files));
    const f = r.findings.find((x) => x.name === "github.com/apple/swift-nio")!;
    expect(f).toMatchObject({ current: "2.29.0", checkedLowerBound: true, fix: { target: "2.100.0" } });
    expect(f.vulns.map((v) => v.id).sort()).toEqual([...IDS].sort());
    expect(f.update?.edit[0]?.newText).toBe("2.100.0");
  });

  it("flags Package.resolved entries", async () => {
    const path = "/ws/Package.resolved";
    const files = { [path]: read("swift", "Package.resolved") };
    const r = await scanDocument(`file://${path}`, path, files[path], ctx(files));
    expect(r.findings.find((x) => x.name === "github.com/apple/swift-nio")?.vulns).toHaveLength(3);
  });
});
