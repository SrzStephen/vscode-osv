import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { scanDocument as scanDocumentNative, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { pubModule } from "../../../src/ecosystems/pub/index.js";
import { memFs, posixResult } from "../../helpers/memFs.js";

// Findings carry native paths and file URIs; compare them in POSIX form on every platform.
const scanDocument = posixResult(scanDocumentNative);

const fixtures = join(__dirname, "..", "..", "fixtures");
const read = (...p: string[]): string => readFileSync(join(fixtures, ...p), "utf8");
const records = (): OsvRecord[] => [JSON.parse(read("osv", "GHSA-4rgh-jx4f-qfcq.json")) as OsvRecord];

function ctx(files: Record<string, string>, queried: PackageQuery[] = []): ScanContext {
  return {
    files: memFs(files),
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) {
          queried.push(q);
          results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "http" ? records() : [], cached: false });
        }
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

describe("pubModule", () => {
  it("is registered and classifies files", () => {
    expect(ALL_MODULES).toContain(pubModule);
    expect(classifyFile("app/pubspec.yaml")).toMatchObject({ role: "manifest" });
    expect(classifyFile("pubspec.lock")).toMatchObject({ role: "lockfile" });
    expect(classifyFile("pubspec.yaml")?.module.id).toBe("pub");
  });

  it("declares ids and file mappings", () => {
    expect(pubModule).toMatchObject({ id: "pub", osvEcosystem: "Pub", manifests: ["pubspec.yaml"], lockfiles: ["pubspec.lock"] });
    expect(pubModule.lockfilesForManifest("pubspec.yaml")).toEqual(["pubspec.lock"]);
    expect(pubModule.manifestForLockfile("pubspec.lock")).toBe("pubspec.yaml");
    expect(pubModule.transitiveFix({ name: "x", current: "1.0.0", target: "1.1.0", lockfilePath: "/p/pubspec.lock" })).toBeUndefined();
  });

  it("uses flutter pub get for Flutter projects and dart pub get otherwise", () => {
    const base = { manifestPath: "/p/pubspec.yaml", name: "http", target: "0.13.3" };
    expect(pubModule.lockCommand({ ...base, manifestText: read("pub", "pubspec.yaml") })).toBe("flutter pub get");
    expect(pubModule.lockCommand({ ...base, manifestText: "dependencies:\n  http: 0.12.0\n" })).toBe("dart pub get");
    expect(pubModule.lockCommand({ ...base, manifestText: "dev_dependencies:\n  flutter_test:\n    sdk: flutter\n" })).toBe("flutter pub get");
    expect(pubModule.lockCommand(base)).toBe("dart pub get");
  });

  it("skips the Flutter SDK dependency and locks http at 0.12.0", async () => {
    const files = { "/ws/pubspec.yaml": read("pub", "pubspec.yaml"), "/ws/pubspec.lock": read("pub", "pubspec.lock") };
    const queried: PackageQuery[] = [];
    await scanDocument("file:///ws/pubspec.yaml", "/ws/pubspec.yaml", files["/ws/pubspec.yaml"], ctx(files, queried));
    expect(queried.map((q) => q.name)).not.toContain("flutter");
    expect(queried.find((q) => q.name === "http")).toMatchObject({ ecosystem: "Pub", version: "0.12.0" });
  });

  it("http 0.12.0 with the real record -> 0.13.3", async () => {
    const files = { "/ws/pubspec.yaml": "dependencies:\n  http: 0.12.0\n" };
    const r = await scanDocument("file:///ws/pubspec.yaml", "/ws/pubspec.yaml", files["/ws/pubspec.yaml"], ctx(files));
    const f = r.findings.find((x) => x.name === "http")!;
    expect(f).toMatchObject({ current: "0.12.0", checkedLowerBound: true, fix: { target: "0.13.3" } });
    expect(f.vulns.map((v) => v.id)).toEqual(["GHSA-4rgh-jx4f-qfcq"]);
    expect(f.update?.edit[0]?.newText).toBe("0.13.3");
  });
});
