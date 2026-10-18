import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { LineIndex } from "../../../src/core/lineIndex.js";
import { scanDocument, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery, TextRange } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { goModule } from "../../../src/ecosystems/go/index.js";

const fixtures = join(__dirname, "..", "..", "fixtures");
const records = (): OsvRecord[] =>
  ["GO-2021-0113", "GO-2022-1059"].map((id) => JSON.parse(readFileSync(join(fixtures, "osv", `${id}.json`), "utf8")) as OsvRecord);

function ctx(files: Record<string, string>): ScanContext {
  return {
    files: { read: async (p) => files[p], list: async () => [] },
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "golang.org/x/text" ? records() : [], cached: false });
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

const apply = (text: string, edit: { range: TextRange; newText: string }): string => {
  const ix = new LineIndex(text);
  return text.slice(0, ix.offset(edit.range.start)) + edit.newText + text.slice(ix.offset(edit.range.end));
};

describe("goModule", () => {
  it("is registered and classifies go.mod as a manifest", () => {
    expect(ALL_MODULES).toContain(goModule);
    expect(classifyFile("go.mod")).toMatchObject({ role: "manifest" });
    expect(classifyFile("svc/go.mod")?.module.id).toBe("go");
  });

  it("declares ids and flags", () => {
    expect(goModule).toMatchObject({ id: "go", osvEcosystem: "Go", manifests: ["go.mod"], lockfiles: [], manifestIsExact: true });
    expect(goModule.lockfilesForManifest("go.mod")).toEqual([]);
    expect(goModule.normalizeName("Github.com/Foo")).toBe("Github.com/Foo");
    expect(goModule.versioning.compare("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });

  it("rewriteSpec prefixes v without duplicating it", () => {
    expect(goModule.rewriteSpec("v0.3.5", "0.3.8")).toEqual({ spec: "v0.3.8", widened: false });
    expect(goModule.rewriteSpec("v0.3.5", "v0.3.8").spec).toBe("v0.3.8");
  });

  it("lockCommand and transitiveFix", () => {
    expect(goModule.lockCommand({ manifestPath: "/ws/go.mod", name: "golang.org/x/text", target: "0.3.8" })).toBe("go get golang.org/x/text@v0.3.8 && go mod tidy");
    expect(goModule.lockCommand({ manifestPath: "/ws/go.mod", name: "x; rm -rf /", target: "0.3.8" })).toBeUndefined();
    expect(goModule.lockCommand({ manifestPath: "/ws/go.mod", name: "a/b", target: "0.3.8; evil" })).toBeUndefined();
    expect(goModule.transitiveFix({ name: "a", current: "1", target: "2", lockfilePath: "/ws/go.sum" })).toBeUndefined();
  });

  it("parseLockfile is unsupported", () => {
    expect(() => goModule.parseLockfile("", "go.sum")).toThrow();
  });

  it("go.mod golang.org/x/text v0.3.5 is fixed by 0.3.8 with edit text v0.3.8", async () => {
    const text = "module example.com/app\n\ngo 1.21\n\nrequire (\n\tgolang.org/x/text v0.3.5\n)\n";
    const r = await scanDocument("file:///ws/go.mod", "/ws/go.mod", text, ctx({ "/ws/go.mod": text }));
    const f = r.findings.find((x) => x.name === "golang.org/x/text")!;
    expect(f).toMatchObject({ current: "v0.3.5", checkedLowerBound: false, fix: { target: "0.3.8" }, update: { kind: "direct" } });
    expect(f.update!.edit).toHaveLength(1);
    expect(f.update!.edit[0]!.newText).toBe("v0.3.8");
    expect(apply(text, f.update!.edit[0]!)).toContain("golang.org/x/text v0.3.8");
    expect(f.update!.lockCommand).toEqual({ cwd: "/ws", command: "go get golang.org/x/text@v0.3.8 && go mod tidy" });
  });

  it("a replaced module is edited at the replace line", async () => {
    const text = "module m\nrequire golang.org/x/text v0.3.9\nreplace golang.org/x/text => golang.org/x/text v0.3.5\n";
    const r = await scanDocument("file:///ws/go.mod", "/ws/go.mod", text, ctx({}));
    const f = r.findings.find((x) => x.name === "golang.org/x/text")!;
    expect(f).toBeDefined();
    expect(apply(text, f.update!.edit[0]!)).toBe("module m\nrequire golang.org/x/text v0.3.9\nreplace golang.org/x/text => golang.org/x/text v0.3.8\n");
  });
});
