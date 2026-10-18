import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { scanDocument, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { rubygemsModule } from "../../../src/ecosystems/rubygems/index.js";

const fixtures = join(__dirname, "..", "..", "fixtures");
const read = (...p: string[]): string => readFileSync(join(fixtures, ...p), "utf8");
const records = (): OsvRecord[] =>
  ["GHSA-22f2-v57c-j9cx", "GHSA-625h-95r8-8xpm", "GHSA-6xw4-3v39-52mm"].map((id) => JSON.parse(read("osv", `${id}.json`)) as OsvRecord);

function ctx(files: Record<string, string>): ScanContext {
  return {
    files: {
      read: async (p) => files[p],
      list: async (d) => Object.keys(files).filter((f) => f.startsWith(`${d}/`) && !f.slice(d.length + 1).includes("/")).map((f) => f.slice(d.length + 1)),
    },
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "rack" ? records() : [], cached: false });
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

describe("rubygemsModule", () => {
  it("is registered and classifies files", () => {
    expect(ALL_MODULES).toContain(rubygemsModule);
    for (const p of ["Gemfile", "x/gems.rb", "app.gemspec", "a/b/app.gemspec"]) expect(classifyFile(p)).toMatchObject({ role: "manifest" });
    for (const p of ["Gemfile.lock", "x/gems.locked"]) expect(classifyFile(p)).toMatchObject({ role: "lockfile" });
    expect(classifyFile("Gemfile")?.module.id).toBe("rubygems");
  });

  it("declares ids and file mappings", () => {
    expect(rubygemsModule).toMatchObject({ id: "rubygems", osvEcosystem: "RubyGems", manifests: ["Gemfile", "gems.rb", "*.gemspec"], lockfiles: ["Gemfile.lock", "gems.locked"] });
    expect(rubygemsModule.lockfilesForManifest("Gemfile")).toEqual(["Gemfile.lock"]);
    expect(rubygemsModule.lockfilesForManifest("gems.rb")).toEqual(["gems.locked"]);
    expect(rubygemsModule.lockfilesForManifest("app.gemspec")).toEqual(["Gemfile.lock"]);
    expect(rubygemsModule.manifestsForLockfile?.("Gemfile.lock")).toEqual(["Gemfile"]);
    expect(rubygemsModule.manifestsForLockfile?.("gems.locked")).toEqual(["gems.rb"]);
  });

  it("dispatches parsing by file name", () => {
    expect(rubygemsModule.parseManifest(read("rubygems", "Gemfile"), "Gemfile")).toHaveLength(4);
    expect(rubygemsModule.parseManifest(read("rubygems", "app.gemspec"), "app.gemspec")).toHaveLength(4);
    expect(rubygemsModule.parseManifest('gem "a", "1"', "gems.rb")).toHaveLength(1);
    expect(rubygemsModule.parseLockfile(read("rubygems", "Gemfile.lock"), "Gemfile.lock").length).toBeGreaterThan(0);
  });

  it("rewriteSpec keeps the quote style and separators", () => {
    expect(rubygemsModule.rewriteSpec("'~> 2.2', '>= 2.2.3'", "2.2.20")).toEqual({ spec: "'~> 2.2', '>= 2.2.20'", widened: false });
    expect(rubygemsModule.rewriteSpec('"1.0"', "2.0")).toEqual({ spec: '"2.0"', widened: false });
    expect(rubygemsModule.rewriteSpec('"~> 1.0"', "2.5.1")).toEqual({ spec: '"~> 2.5", ">= 2.5.1"', widened: true });
  });

  it("lock command", () => expect(rubygemsModule.lockCommand({ manifestPath: "/p/Gemfile", name: "rack", target: "2.2.20" })).toBe("bundle install"));

  it("transitive command", () =>
    expect(rubygemsModule.transitiveFix({ name: "racc", current: "1.6.0", target: "1.6.2", lockfilePath: "/p/Gemfile.lock" })?.lockCommand?.command).toBe("bundle update --conservative racc"));

  it("transitive fix is command-only in the lockfile directory", () =>
    expect(rubygemsModule.transitiveFix({ name: "racc", current: "1.6.0", target: "1.6.2", lockfilePath: "/p/Gemfile.lock" })).toEqual({
      kind: "command-only",
      edit: [],
      lockCommand: { cwd: "/p", command: "bundle update --conservative racc" },
    }));

  it("refuses shell-unsafe names", () =>
    expect(rubygemsModule.transitiveFix({ name: "a;b", current: "1", target: "2", lockfilePath: "/p/Gemfile.lock" })).toBeUndefined());

  it("refuses names that would read as an option", () =>
    expect(rubygemsModule.transitiveFix({ name: "--all", current: "1", target: "2", lockfilePath: "/p/Gemfile.lock" })).toBeUndefined());

  it("rack 2.2.3 with three real records -> 2.2.20", async () => {
    const files = { "/ws/Gemfile": "gem 'rack', '~> 2.2', '>= 2.2.3'\n" };
    const r = await scanDocument("file:///ws/Gemfile", "/ws/Gemfile", files["/ws/Gemfile"], ctx(files));
    const f = r.findings.find((x) => x.name === "rack")!;
    expect(f).toMatchObject({ current: "2.2.3", checkedLowerBound: true, fix: { target: "2.2.20" } });
    expect(f.vulns.map((v) => v.id).sort()).toEqual(["GHSA-22f2-v57c-j9cx", "GHSA-625h-95r8-8xpm", "GHSA-6xw4-3v39-52mm"]);
    expect(f.update?.edit[0]?.newText).toBe("'~> 2.2', '>= 2.2.20'");
  });

  it("uses the locked version when a lockfile exists", async () => {
    const files = { "/ws/Gemfile": read("rubygems", "Gemfile"), "/ws/Gemfile.lock": read("rubygems", "Gemfile.lock") };
    const r = await scanDocument("file:///ws/Gemfile", "/ws/Gemfile", files["/ws/Gemfile"], ctx(files));
    expect(r.findings.find((x) => x.name === "rack")).toMatchObject({ current: "2.2.3", checkedLowerBound: false, fix: { target: "2.2.20" } });
  });
});
