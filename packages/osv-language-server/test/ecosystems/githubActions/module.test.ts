import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { scanDocument as scanDocumentNative, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { githubActionsModule } from "../../../src/ecosystems/githubActions/index.js";
import { posixResult } from "../../helpers/memFs.js";

// Findings carry native paths and file URIs; compare them in POSIX form on every platform.
const scanDocument = posixResult(scanDocumentNative);

const fixtures = join(__dirname, "..", "..", "fixtures");
const records = (): OsvRecord[] => ["GHSA-mrrh-fwg8-r2c3", "GHSA-mcph-m25j-8j63"].map((id) => JSON.parse(readFileSync(join(fixtures, "osv", `${id}.json`), "utf8")) as OsvRecord);

function ctx(queried: PackageQuery[] = []): ScanContext {
  return {
    files: { read: async () => undefined, list: async () => [] },
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) {
          queried.push(q);
          results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records: q.name === "tj-actions/changed-files" && q.version === "" ? records() : [], cached: false });
        }
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

const wf = (ref: string): string => `jobs:\n  b:\n    steps:\n      - uses: tj-actions/changed-files@${ref}\n`;
const path = "/ws/.github/workflows/ci.yml";
const uri = "file:///ws/.github/workflows/ci.yml";

describe("githubActionsModule", () => {
  it("is registered and classifies nested workflow paths", () => {
    expect(ALL_MODULES).toContain(githubActionsModule);
    expect(classifyFile(".github/workflows/ci.yml")?.module.id).toBe("githubActions");
    expect(classifyFile("sub/.github/workflows/ci.yaml")?.module.id).toBe("githubActions");
    expect(classifyFile("action.yml")?.module.id).toBe("githubActions");
    expect(classifyFile("tools/x/action.yaml")?.module.id).toBe("githubActions");
  });

  it("declares ids and flags", () => {
    expect(githubActionsModule).toMatchObject({ id: "githubActions", osvEcosystem: "GitHub Actions", lockfiles: [], manifestIsExact: true, clientSideMatching: true });
    expect(githubActionsModule.normalizeName("Actions/Checkout")).toBe("Actions/Checkout");
    expect(githubActionsModule.nameKey?.("Actions/Checkout")).toBe("actions/checkout");
    expect(githubActionsModule.lockCommand({ manifestPath: path, name: "a/b", target: "1.0.0" })).toBeUndefined();
    expect(githubActionsModule.transitiveFix({ name: "a/b", current: "1", target: "2", lockfilePath: "x" })).toBeUndefined();
  });

  it("rewrites specs keeping the v prefix and lossless precision", () => {
    const rw = (raw: string, t: string): string => githubActionsModule.rewriteSpec(raw, t).spec;
    expect(rw("v45", "46.0.0")).toBe("v46");
    expect(rw("v45", "46.0.1")).toBe("v46.0.1");
    expect(rw("45", "46.0.0")).toBe("46");
    expect(rw("v4.1", "4.2.0")).toBe("v4.2");
    expect(rw("v4.1", "4.2.3")).toBe("v4.2.3");
    expect(rw("v4.1.1", "5.0.0")).toBe("v5.0.0");
  });

  it("tj-actions/changed-files@v45 -> v46.0.1 via package-only query", async () => {
    const queried: PackageQuery[] = [];
    const r = await scanDocument(uri, path, wf("v45"), ctx(queried));
    expect(queried.map((q) => q.version)).toEqual([""]);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.vulns.map((v) => v.id).sort()).toEqual(["GHSA-mrrh-fwg8-r2c3"]);
    expect(f.fix?.target).toBe("46.0.1");
    expect(f.update?.edit[0]?.newText).toBe("v46.0.1");
  });

  it("keeps both records for a ref below both fixed versions", async () => {
    const r = await scanDocument(uri, path, wf("v40"), ctx());
    expect(r.findings[0]!.vulns.map((v) => v.id).sort()).toEqual(["GHSA-mcph-m25j-8j63", "GHSA-mrrh-fwg8-r2c3"]);
  });

  it("reports no finding once the ref is at the fixed version", async () => {
    const r = await scanDocument(uri, path, wf("v46.0.1"), ctx());
    expect(r.findings).toHaveLength(0);
  });

  it("never queries a SHA-pinned or branch-pinned action", async () => {
    const queried: PackageQuery[] = [];
    const text = wf("0e58ed8671d6b60d0890c21b07f8835ace038e67 # v4.1.1") + "      - uses: tj-actions/changed-files@main\n";
    const r = await scanDocument(uri, path, text, ctx(queried));
    expect(queried).toEqual([]);
    expect(r.findings).toHaveLength(0);
  });
});
