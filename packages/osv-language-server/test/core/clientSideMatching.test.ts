import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../src/core/ignores.js";
import { OsvClient } from "../../src/core/osvClient.js";
import { scanDocument, type ScanContext } from "../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../src/core/settings.js";
import type { DeclaredDep, OsvRecord, PackageQuery, ResolvedDep, TextRange } from "../../src/core/types.js";
import type { EcosystemModule } from "../../src/ecosystems/types.js";
import { npmModule } from "../../src/ecosystems/npm/index.js";
import { semverLooseComparator } from "../../src/versioning/semverLoose.js";
import { startFakeOsv } from "../helpers/fakeOsv.js";

const fixture = (id: string): OsvRecord => JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "osv", `${id}.json`), "utf8")) as OsvRecord;
const r = (line: number, a: number, b: number): TextRange => ({ start: { line, character: a }, end: { line, character: b } });

type Fake = Awaited<ReturnType<typeof startFakeOsv>>;
let fake: Fake | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

describe("package-only queries", () => {
  it("omits version from the request body", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    const client = new OsvClient({ baseUrl: fake.url, userAgent: "osv-language-server/test", dispatcher: new Agent() });
    await client.queryBatch([{ ecosystem: "GitHub Actions", name: "tj-actions/changed-files", version: "" }]);
    const query = (fake.requests[0]!.body as { queries: Record<string, unknown>[] }).queries[0]!;
    expect(query).toEqual({ package: { name: "tj-actions/changed-files", ecosystem: "GitHub Actions" } });
    expect("version" in query).toBe(false);
  });
});

describe("client-side matching in the scanner", () => {
  const NAME = "tj-actions/changed-files";
  const records = [fixture("GHSA-mcph-m25j-8j63"), fixture("GHSA-mrrh-fwg8-r2c3")];

  const mod: EcosystemModule = {
    ...npmModule,
    id: "fake",
    osvEcosystem: "GitHub Actions",
    manifests: ["deps.txt"],
    lockfiles: [],
    lockfilesForManifest: () => [],
    manifestForLockfile: () => undefined,
    versioning: semverLooseComparator,
    clientSideMatching: true,
    parseManifest: (text) =>
      text
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l, i): DeclaredDep => {
          const [name = "", spec = ""] = l.split(" ");
          return { name, nameRange: r(i, 0, name.length), rawSpec: spec, lowerBound: spec, specRange: r(i, name.length + 1, l.length), kind: "registry" };
        }),
    parseLockfile: (): ResolvedDep[] => [],
    rewriteSpec: (_raw, target) => ({ spec: target, widened: false }),
    lockCommand: () => undefined,
  };

  it("sends one package-only query per name and keeps only records that affect the current version", async () => {
    const seen: PackageQuery[] = [];
    const ctx: ScanContext = {
      files: { read: async () => undefined, list: async () => [] },
      osv: {
        lookup: async (queries) => {
          seen.push(...queries);
          const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
          for (const q of queries) results.set(`${q.ecosystem}|${q.name}|${q.version}`, { records, cached: false });
          return { results, offline: false, skipped: [] };
        },
      },
      settings: { ...DEFAULT_SETTINGS },
      ignores: new IgnoreMatcher([], [], new Date()),
      rootDir: "/ws",
      modules: [mod],
    };
    const res = await scanDocument("file:///ws/deps.txt", "/ws/deps.txt", `${NAME} 45\n${NAME} 45\n`, ctx);
    expect(seen).toEqual([{ ecosystem: "GitHub Actions", name: NAME, version: "" }]);
    expect(res.findings).toHaveLength(2);
    const f = res.findings[0]!;
    expect(f.vulns.map((v) => v.id)).toEqual(["GHSA-mrrh-fwg8-r2c3"]);
    expect(f.fix.target).toBe("46.0.1");
  });
});
