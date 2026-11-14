import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiskCache } from "../src/core/cache.js";
import { runCheck } from "../src/cli.js";
import type { Finding, OsvRecord } from "../src/core/types.js";
import { startFakeOsv } from "./helpers/fakeOsv.js";

const IDS = ["GHSA-p6mc-m468-83gw", "GHSA-35jh-r3h4-6jhm", "GHSA-29mw-wpgm-hmr9"];
const records = Object.fromEntries(
  IDS.map((id) => [id, JSON.parse(readFileSync(join(__dirname, "fixtures", "osv", `${id}.json`), "utf8")) as OsvRecord]),
);
const REPOS = join(__dirname, "fixtures", "repos");
const VULNERABLE = join(REPOS, "vulnerable");
const CLEAN = join(REPOS, "clean");

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function fakeOsv(opts: { closed?: boolean } = {}) {
  const fake = await startFakeOsv({ packages: { "npm|lodash|4.17.15": IDS }, records });
  if (opts.closed) await fake.close();
  else cleanups.push(() => fake.close());
  return fake;
}

async function check(cwd: string, args: string[], fake: { url: string }, cacheDir = tmp("osv-cli-cache-")) {
  let stdout = "";
  let stderr = "";
  const code = await runCheck([...args, "--api-base-url", fake.url, "--cache-dir", cacheDir], {
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
    cwd,
    env: {},
  });
  return { code, stdout, stderr };
}

describe("osv-check", () => {
  it("reports a vulnerable dependency with exit 1", async () => {
    const r = await check(VULNERABLE, [], await fakeOsv());
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("package.json:4:16  high  lodash 4.17.15 → 4.17.21  GHSA-35jh-r3h4-6jhm, +2 more\n");
    expect(r.stdout).toContain("1 vulnerable dependencies in 1 files\n");
    expect(r.stdout).toContain("1 vulnerable dependencies in 1 files\n1 high\n");
    expect(r.stderr).toBe("");
  });

  it("sends the osv-language-server/<version> User-Agent", async () => {
    const fake = await fakeOsv();
    await check(VULNERABLE, [], fake);
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const r of fake.requests) expect(r.userAgent).toMatch(/^osv-language-server\/\d+\.\d+\.\d+/);
  });

  it("reports a clean repo with exit 0", async () => {
    const r = await check(CLEAN, [], await fakeOsv());
    expect(r).toEqual({ code: 0, stdout: "No known vulnerabilities\n", stderr: "" });
  });

  it("exits 0 when findings are below --min-severity", async () => {
    const r = await check(VULNERABLE, ["--min-severity", "critical"], await fakeOsv());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("No known vulnerabilities\n");
  });

  it("--only-fixable keeps findings that have a fix", async () => {
    const r = await check(VULNERABLE, ["--only-fixable"], await fakeOsv());
    expect(r.code).toBe(1);
    expect(r.stdout).not.toBe("No known vulnerabilities\n");
  });

  it("prints parseable JSON with --format json", async () => {
    const r = await check(VULNERABLE, ["--format", "json"], await fakeOsv());
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout) as { findings: Finding[]; offline: boolean };
    expect(out.offline).toBe(false);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ name: "lodash", current: "4.17.15", severity: "high" });
  });

  it("prints an empty JSON result for a clean repo", async () => {
    const r = await check(CLEAN, ["--format", "json"], await fakeOsv());
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ findings: [], offline: false });
  });

  it("rejects an unknown option with usage on stderr and exit 2", async () => {
    const r = await check(CLEAN, ["--bogus"], await fakeOsv());
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Usage: osv-check");
  });

  it("rejects an invalid option value with exit 2", async () => {
    expect((await check(CLEAN, ["--format", "xml"], await fakeOsv())).code).toBe(2);
    expect((await check(CLEAN, ["--min-severity", "urgent"], await fakeOsv())).code).toBe(2);
  });

  it("warns and exits 0 when OSV is unreachable and nothing is cached", async () => {
    const r = await check(VULNERABLE, [], await fakeOsv({ closed: true }));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("Results incomplete: no vulnerability data (OSV unreachable, no cache)\n");
    expect(r.stderr).toBe("warning: osv.dev unreachable and no cached data; results incomplete\n");
  });

  it("exits 2 with --strict when OSV is unreachable and nothing is cached", async () => {
    const r = await check(VULNERABLE, ["--strict"], await fakeOsv({ closed: true }));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("warning: osv.dev unreachable and no cached data; results incomplete");
  });

  it("keeps the normal summary and marks findings (cached) when offline with stale cache", async () => {
    const cacheDir = tmp("osv-cli-cache-");
    const cache = new DiskCache(cacheDir);
    const stale = new Date(Date.now() - 100 * 3600_000).toISOString();
    await cache.putPackage({ ecosystem: "npm", name: "lodash", version: "4.17.15" }, { fetchedAt: stale, vulnIds: IDS.map((id) => ({ id, modified: records[id]!.modified })) });
    for (const id of IDS) await cache.putVuln(records[id]!);
    const r = await check(VULNERABLE, [], await fakeOsv({ closed: true }), cacheDir);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("GHSA-35jh-r3h4-6jhm, +2 more (cached)\n");
    expect(r.stdout).toContain("1 vulnerable dependencies in 1 files\n");
    expect(r.stderr).toBe("");
  });

  it("ends with the incomplete line when offline with only part of the data cached", async () => {
    const root = tmp("osv-cli-repo-");
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { lodash: "4.17.15", "left-pad": "1.3.0" } }, null, 2));
    const cacheDir = tmp("osv-cli-cache-");
    const cache = new DiskCache(cacheDir);
    const stale = new Date(Date.now() - 100 * 3600_000).toISOString();
    await cache.putPackage({ ecosystem: "npm", name: "lodash", version: "4.17.15" }, { fetchedAt: stale, vulnIds: IDS.map((id) => ({ id, modified: records[id]!.modified })) });
    for (const id of IDS) await cache.putVuln(records[id]!);
    const r = await check(root, [], await fakeOsv({ closed: true }), cacheDir);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("lodash 4.17.15 → 4.17.21  GHSA-35jh-r3h4-6jhm, +2 more (cached)\n");
    expect(r.stdout.endsWith("Results incomplete: no vulnerability data (OSV unreachable, no cache)\n")).toBe(true);
    expect(r.stdout).not.toContain("vulnerable dependencies");
    expect(r.stderr).toBe("warning: osv.dev unreachable and no cached data; results incomplete\n");
  });

  it("serves a second run from the shared cache without contacting OSV", async () => {
    const cacheDir = tmp("osv-cli-cache-");
    expect((await check(VULNERABLE, [], await fakeOsv(), cacheDir)).code).toBe(1);
    const r = await check(VULNERABLE, ["--strict"], await fakeOsv({ closed: true }), cacheDir);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("");
  });

  it("ignores explicit paths that are not manifests or lockfiles", async () => {
    const r = await check(VULNERABLE, ["README.md", "src/app.ts"], await fakeOsv());
    expect(r).toEqual({ code: 0, stdout: "No known vulnerabilities\n", stderr: "" });
  });

  it("scans only the explicit paths that match", async () => {
    const root = tmp("osv-cli-repo-");
    writeFileSync(join(root, "package.json"), readFileSync(join(VULNERABLE, "package.json")));
    const r = await check(root, ["README.md", "package.json"], await fakeOsv());
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("package.json:4:16  high  lodash");
  });

  it("applies osv-scanner.toml ignores", async () => {
    const root = tmp("osv-cli-repo-");
    writeFileSync(join(root, "package.json"), readFileSync(join(VULNERABLE, "package.json")));
    writeFileSync(join(root, "osv-scanner.toml"), IDS.map((id) => `[[IgnoredVulns]]\nid = "${id}"\n`).join("\n"));
    const r = await check(root, [], await fakeOsv());
    expect(r).toEqual({ code: 0, stdout: "No known vulnerabilities\n", stderr: "" });
  });

  it("prints help and version with exit 0", async () => {
    const help = await check(CLEAN, ["--help"], await fakeOsv());
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: osv-check");
    const version = await check(CLEAN, ["--version"], await fakeOsv());
    expect(version.code).toBe(0);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe("osv-check Phase 2 ecosystems", () => {
  const osvRecord = (id: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "osv", `${id}.json`), "utf8")) as OsvRecord;
  const LOG4J = ["GHSA-jfh8-c2jp-5v3q", "GHSA-7rjr-3q55-vv33", "GHSA-p6xc-xr62-6r2g", "GHSA-8489-44mv-ggj8"];
  const CASES: { repo: string; key: string; ids: string[]; line: RegExp }[] = [
    { repo: "cargo", key: "crates.io|smallvec|0.6.9", ids: ["GHSA-43w2-9j62-hq99", "GHSA-66p5-j55p-32r9"], line: /Cargo\.toml:7:\d+ {2}\w+ {2}smallvec 0\.6\.9 → 0\.6\.14 {2}/ },
    { repo: "maven", key: "Maven|org.apache.logging.log4j:log4j-core|2.14.1", ids: LOG4J, line: /pom\.xml:\d+:\d+ {2}\w+ {2}org\.apache\.logging\.log4j:log4j-core 2\.14\.1 → 2\.17\.1 {2}/ },
    { repo: "gradle", key: "Maven|org.apache.logging.log4j:log4j-core|2.14.1", ids: LOG4J, line: /build\.gradle:6:\d+ {2}\w+ {2}org\.apache\.logging\.log4j:log4j-core 2\.14\.1 → 2\.17\.1 {2}/ },
    { repo: "go", key: "Go|golang.org/x/text|v0.3.5", ids: ["GO-2021-0113", "GO-2022-1059"], line: /go\.mod:5:\d+ {2}\w+ {2}golang\.org\/x\/text v?0\.3\.5 → v?0\.3\.8 {2}/ },
    { repo: "nuget", key: "NuGet|Newtonsoft.Json|12.0.3", ids: ["GHSA-5crp-9r3c-p9vr"], line: /app\.csproj:6:\d+ {2}\w+ {2}Newtonsoft\.Json 12\.0\.3 → 13\.0\.1 {2}/ },
  ];

  for (const c of CASES) {
    it(`${c.repo}: reports the vulnerable dependency with exit 1`, async () => {
      const fake = await startFakeOsv({ packages: { [c.key]: c.ids }, records: Object.fromEntries(c.ids.map((id) => [id, osvRecord(id)])) });
      cleanups.push(() => fake.close());
      const r = await check(join(REPOS, c.repo), [], fake);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(c.line);
      expect(r.stderr).toBe("");
    });
  }
});

describe("osv-check Phase 3 ecosystems", () => {
  const osvRecord = (id: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "osv", `${id}.json`), "utf8")) as OsvRecord;
  const CASES: { repo: string; key: string; ids: string[]; line: RegExp }[] = [
    { repo: "rubygems", key: "RubyGems|rack|2.2.3", ids: ["GHSA-22f2-v57c-j9cx", "GHSA-625h-95r8-8xpm", "GHSA-6xw4-3v39-52mm"], line: /Gemfile:3:\d+ {2}\w+ {2}rack 2\.2\.3 → 2\.2\.20 {2}/ },
    { repo: "packagist", key: "Packagist|guzzlehttp/guzzle|7.4.4", ids: ["GHSA-25mq-v84q-4j7r", "GHSA-f283-ghqc-fg79"], line: /composer\.json:5:\d+ {2}\w+ {2}guzzlehttp\/guzzle 7\.4\.4 → 7\.15\.1 {2}/ },
    { repo: "actions", key: "GitHub Actions|tj-actions/changed-files|", ids: ["GHSA-mrrh-fwg8-r2c3", "GHSA-mcph-m25j-8j63"], line: /ci\.yml:7:\d+ {2}\w+ {2}tj-actions\/changed-files 45 → 46\.0\.1 {2}/ },
    { repo: "pub", key: "Pub|http|0.12.0", ids: ["GHSA-4rgh-jx4f-qfcq"], line: /pubspec\.yaml:6:\d+ {2}\w+ {2}http 0\.12\.0 → 0\.13\.3 {2}/ },
    { repo: "hex", key: "Hex|plug|1.3.0", ids: ["EEF-CVE-2026-56813"], line: /mix\.exs:\d+:\d+ {2}\w+ {2}plug 1\.3\.0 → 1\.16\.6 {2}/ },
    { repo: "swift", key: "SwiftURL|github.com/apple/swift-nio|2.29.0", ids: ["GHSA-cq87-8r7h-962v", "GHSA-r3rc-9hpw-54v9", "GHSA-rj37-6j9x-74q6"], line: /Package\.swift:7:\d+ {2}\w+ {2}github\.com\/apple\/swift-nio 2\.29\.0 → 2\.100\.0 {2}/ },
  ];

  for (const c of CASES) {
    it(`${c.repo}: reports the vulnerable dependency with exit 1`, async () => {
      const fake = await startFakeOsv({ packages: { [c.key]: c.ids }, records: Object.fromEntries(c.ids.map((id) => [id, osvRecord(id)])) });
      cleanups.push(() => fake.close());
      const r = await check(join(REPOS, c.repo), [], fake);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(c.line);
      expect(r.stderr).toBe("");
    });
  }
});
