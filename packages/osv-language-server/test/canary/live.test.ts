// Live canary: talks to the real https://api.osv.dev. Excluded from the default
// vitest run; execute with `npm run test:canary`.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiskCache } from "../../src/core/cache.js";
import { calculateFix } from "../../src/core/fixCalculator.js";
import { OsvClient } from "../../src/core/osvClient.js";
import { OsvService, queryKey } from "../../src/core/osvService.js";
import type { PackageQuery } from "../../src/core/types.js";
import { cargoModule } from "../../src/ecosystems/cargo/index.js";
import { goModule } from "../../src/ecosystems/go/index.js";
import { mavenModule } from "../../src/ecosystems/maven/index.js";
import { npmModule } from "../../src/ecosystems/npm/index.js";
import { nugetModule } from "../../src/ecosystems/nuget/index.js";
import { pypiModule } from "../../src/ecosystems/pypi/index.js";
import type { EcosystemModule } from "../../src/ecosystems/types.js";

const service = () =>
  new OsvService(
    new OsvClient({ baseUrl: "https://api.osv.dev", userAgent: "vscode-osv-canary" }),
    new DiskCache(mkdtempSync(join(tmpdir(), "osv-canary-"))),
    () => 24,
  );

async function check(mod: EcosystemModule, name: string, version: string, minTarget: string): Promise<void> {
  const q: PackageQuery = { ecosystem: mod.osvEcosystem, name, version };
  const outcome = await service().lookup([q]);
  expect(outcome.offline).toBe(false);
  const records = outcome.results.get(queryKey(q))?.records ?? [];
  expect(records.length).toBeGreaterThanOrEqual(1);
  const fix = calculateFix(records, mod.osvEcosystem, name, version, mod.versioning, mod.normalizeName);
  expect(fix.target).toBeDefined();
  expect(mod.versioning.compare(fix.target!, minTarget)).toBeGreaterThanOrEqual(0);
}

describe("live OSV canary", () => {
  it("npm lodash@4.17.15 has records and a fix >= 4.17.21", () => check(npmModule, "lodash", "4.17.15", "4.17.21"), 60_000);
  it("PyPI requests@2.25.0 has records and a fix >= 2.31.0", () => check(pypiModule, "requests", "2.25.0", "2.31.0"), 60_000);
  it("Maven log4j-core@2.14.1 has records and a fix >= 2.17.1", () => check(mavenModule, "org.apache.logging.log4j:log4j-core", "2.14.1", "2.17.1"), 60_000);
  it("Go golang.org/x/text@v0.3.5 has records and a fix >= 0.3.8", () => check(goModule, "golang.org/x/text", "v0.3.5", "0.3.8"), 60_000);
  it("NuGet Newtonsoft.Json@12.0.3 has records and a fix >= 13.0.1", () => check(nugetModule, "Newtonsoft.Json", "12.0.3", "13.0.1"), 60_000);
  it("crates.io smallvec@0.6.9 has records and a fix >= 0.6.14", () => check(cargoModule, "smallvec", "0.6.9", "0.6.14"), 60_000);
});
