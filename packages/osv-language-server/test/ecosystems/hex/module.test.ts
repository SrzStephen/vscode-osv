import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { scanDocument as scanDocumentNative, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { hexModule } from "../../../src/ecosystems/hex/index.js";
import { memFs, posixResult } from "../../helpers/memFs.js";

// Findings carry native paths and file URIs; compare them in POSIX form on every platform.
const scanDocument = posixResult(scanDocumentNative);

const fixtures = join(__dirname, "..", "..", "fixtures");
const read = (...p: string[]): string => readFileSync(join(fixtures, ...p), "utf8");
const record = JSON.parse(read("osv", "EEF-CVE-2026-56813.json")) as OsvRecord;

function ctx(files: Record<string, string>, queried: PackageQuery[] = []): ScanContext {
  return {
    files: memFs(files),
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) {
          queried.push(q);
          results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "plug" ? [record] : [], cached: false });
        }
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

describe("hexModule", () => {
  it("is registered and classifies files", () => {
    expect(ALL_MODULES).toContain(hexModule);
    expect(classifyFile("app/mix.exs")).toMatchObject({ role: "manifest" });
    expect(classifyFile("mix.lock")).toMatchObject({ role: "lockfile" });
    expect(classifyFile("mix.exs")?.module.id).toBe("hex");
  });

  it("declares ids and file mappings", () => {
    expect(hexModule).toMatchObject({ id: "hex", osvEcosystem: "Hex", manifests: ["mix.exs"], lockfiles: ["mix.lock"] });
    expect(hexModule.lockfilesForManifest("mix.exs")).toEqual(["mix.lock"]);
    expect(hexModule.manifestForLockfile("mix.lock")).toBe("mix.exs");
    expect(hexModule.lockCommand({ manifestPath: "/p/mix.exs", name: "plug", target: "1.16.6" })).toBe("mix deps.update plug");
    expect(hexModule.transitiveFix({ name: "x", current: "1.0.0", target: "1.1.0", lockfilePath: "/p/mix.lock" })).toBeUndefined();
  });

  it("does not interpolate unsafe package names into the lock command", () => {
    expect(hexModule.lockCommand({ manifestPath: "/p/mix.exs", name: "x; rm -rf /", target: "1.0.0" })).toBeUndefined();
  });

  it("the record's events put the fix for plug 1.3.0 at 1.16.6", () => {
    const events = record.affected![0]!.ranges![0]!.events;
    expect(events).toEqual([{ introduced: "0.1.0" }, { fixed: "1.16.6" }]);
  });

  it("plug 1.3.0 with the real record -> 1.16.6", async () => {
    const files = { "/ws/mix.exs": 'defmodule M do\n  defp deps do\n    [{:plug, "~> 1.3.0"}]\n  end\nend\n' };
    const r = await scanDocument("file:///ws/mix.exs", "/ws/mix.exs", files["/ws/mix.exs"], ctx(files));
    const f = r.findings.find((x) => x.name === "plug")!;
    expect(f).toMatchObject({ current: "1.3.0", checkedLowerBound: true, fix: { target: "1.16.6" } });
    expect(f.vulns.map((v) => v.id)).toEqual(["EEF-CVE-2026-56813"]);
    expect(f.update?.edit[0]?.newText).toBe("~> 1.16.6");
  });

  it("plug ~> 1.3.0-rc.1 with the real record -> ~> 1.16.6", async () => {
    const files = { "/ws/mix.exs": 'defmodule M do\n  defp deps do\n    [{:plug, "~> 1.3.0-rc.1"}]\n  end\nend\n' };
    const r = await scanDocument("file:///ws/mix.exs", "/ws/mix.exs", files["/ws/mix.exs"], ctx(files));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ current: "1.3.0-rc.1", fix: { target: "1.16.6" }, update: { widened: true } });
    expect(r.findings[0]!.update?.edit[0]?.newText).toBe("~> 1.16.6");
  });

  it("queries the locked plug version from the fixture mix.lock", async () => {
    const files = { "/ws/mix.exs": read("hex", "mix.exs"), "/ws/mix.lock": read("hex", "mix.lock") };
    const queried: PackageQuery[] = [];
    await scanDocument("file:///ws/mix.exs", "/ws/mix.exs", files["/ws/mix.exs"], ctx(files, queried));
    expect(queried.find((q) => q.name === "plug")).toMatchObject({ ecosystem: "Hex", version: "1.3.0" });
  });
});
