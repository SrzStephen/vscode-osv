# OSV Extension — Phase 1 (Core + npm + PyPI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a releasable VS Code extension, standalone LSP server, and `osv-check` CLI that highlight vulnerable npm and PyPI dependencies using osv.dev, with hover, one-click update, lock-command suggestion, shared disk cache and pre-commit docs.

**Architecture:** npm-workspaces monorepo. `packages/osv-language-server` holds all logic as pure units (parsers, comparators, fix calculator) around two I/O units (OSV HTTP client, disk cache), a document scanner that turns text into `Finding[]`, and thin LSP/CLI front ends. `packages/vscode-osv` is a thin `vscode-languageclient` that bundles the server and adds status bar + terminal integration.

**Tech Stack:** TypeScript (strict), Node ≥ 20, esbuild, vitest, eslint (typescript-eslint flat config), vscode-languageserver / vscode-languageserver-textdocument / vscode-languageclient / vscode-jsonrpc, jsonc-parser, toml-eslint-parser, yaml, semver, @renovatebot/pep440, ae-cvss-calculator, undici, picomatch, tsx (dev), @vscode/test-electron, @vscode/vsce, ovsx.

**Spec:** `docs/superpowers/specs/2026-10-18-osv-vscode-extension-design.md`

## Global Constraints

- Server and CLI run on Node ≥ 20 (`"engines": {"node": ">=20"}`); esbuild target `node20`.
- VS Code engine `^1.90.0`; VSIX bundles the server; no platform-specific builds; no telemetry.
- Only package name, version and ecosystem are sent, only to `apiBaseUrl` (default `https://api.osv.dev`).
- `POST /v1/querybatch` ≤ 1000 queries per request, one batch in flight per process; `GET /v1/vulns/{id}` ≤ 8 concurrent; retry 429/5xx/network 3 attempts, exponential backoff with jitter, honour `Retry-After`; User-Agent `osv-language-server/<version>`.
- Cache default TTL **48 h**, minimum 1; per-entry files written via temp file + `rename`; housekeeping deletes package entries older than 7× TTL.
- Debounce 750 ms on `didChange`; newer scan of a document cancels the in-flight one.
- Diagnostic `source` is exactly `"osv"`; `codeDescription.href` is `https://osv.dev/vulnerability/<id>`.
- Severity: critical/high → Error, medium → Warning, low/unknown → Information. CVSS score ≥ 9.0 critical, ≥ 7.0 high, ≥ 4.0 medium, > 0 low.
- Preferred alias ID order: `GHSA-*` > ecosystem-native (`PYSEC-`, `RUSTSEC-`, `GO-`, …) > `CVE-*` > others.
- The server never spawns processes. Lock commands run only from the VS Code client after a click (or `offerLockCommand: "always"`), never in Restricted Mode.
- OSV-provided text (summaries) is escaped in hover markdown; trusted command links limited to `osv.update` and `osv.ignore`.
- `osv-check` exit codes: `0` clean, `1` findings, `2` usage error or (`--strict`) network failure.
- All tests except the nightly live canary run offline.

## Review Focus

1. **Withdrawn advisories** (`withdrawn` set on the OSV record) — a user expects them not to be reported. Test in Task 7 (`osvService` drops withdrawn records).
2. **CRLF line endings and a UTF-8 BOM** — squiggles must land on the version characters on Windows-authored files. Tests in Task 2 (`LineIndex`), Task 9 (package.json) and Task 12 (requirements.txt).
3. **Half-typed manifest while editing** (invalid JSON/TOML) — previous findings stay instead of flickering away. Test in Task 17 (scanner returns `parseError` and server keeps last good findings, Task 21).
4. **Same package declared twice / multiple locked versions** (`dependencies` + `devDependencies`; nested `node_modules` copies) — each occurrence gets its own finding at its own range. Tests in Task 9 and Task 10.
5. **Lockfile above the workspace folder** — resolution must not escape the workspace folder root (multi-root workspaces). Test in Task 16.

---

## File Structure

```
package.json                     workspaces root, scripts
tsconfig.base.json  eslint.config.mjs  vitest.config.ts  .gitignore
.github/workflows/ci.yml  release.yml  canary.yml
.pre-commit-hooks.yaml
docs/pre-commit.md  docs/agents.md
README.md (root, points to packages)
packages/osv-language-server/
  package.json  tsconfig.json  build.mjs  README.md
  src/
    server.ts  cli.ts  serverMain.ts (bin entry)  cliMain.ts (bin entry)
    core/types.ts  lineIndex.ts  graph.ts  settings.ts  ignores.ts  severity.ts
         aliases.ts  fixCalculator.ts  cache.ts  cacheDir.ts  osvClient.ts  osvService.ts
         fileSource.ts  lockfileResolver.ts  scanner.ts  workspaceScanner.ts  findingKey.ts
    versioning/types.ts  semver.ts  pep440.ts
    ecosystems/types.ts  index.ts  jsonEdit.ts
      npm/index.ts  manifest.ts  rewrite.ts  packageLock.ts  bunLock.ts  yarnLock.ts  pnpmLock.ts
      pypi/index.ts  names.ts  requirement.ts  rewrite.ts  requirements.ts  pyproject.ts  pipfile.ts
           poetryLock.ts  uvLock.ts  pipfileLock.ts  pdmLock.ts  pylock.ts
    features/store.ts  diagnostics.ts  hover.ts  codeActions.ts
  test/  (mirrors src; fixtures/ and helpers/fakeOsv.ts, helpers/lspClient.ts)
packages/vscode-osv/
  package.json  tsconfig.json  build.mjs  README.md  CHANGELOG.md  icon.png  .vscodeignore
  src/extension.ts  statusBar.ts  commandRunner.ts  hoverTrust.ts
  test/integration/  (runTest.ts, suite/index.ts, suite/smoke.test.ts, fixture workspace)
```

All commands below run from the repo root.

---

### Task 1: Monorepo scaffold, core types, semver comparator

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`
- Create: `packages/osv-language-server/package.json`, `tsconfig.json`
- Create: `packages/osv-language-server/src/core/types.ts`, `src/versioning/types.ts`, `src/versioning/semver.ts`
- Test: `packages/osv-language-server/test/versioning/semver.test.ts`

**Interfaces:**
- Produces (`core/types.ts`), exactly as spec §5 plus the noted additions:
  - `Severity`, `Position {line, character}`, `TextRange {start, end}`, `DepKind = "registry"|"git"|"path"|"url"|"unresolved"`
  - `DeclaredDep { name; rawSpec?; nameRange; specRange?; lowerBound?; kind; group? }`
  - `ResolvedDep { name; version; range; direct: boolean; via?: string[]; requestedSpecs?: string[] }` (*added* `requestedSpecs`: the specs a lockfile entry was resolved for, e.g. yarn keys `lodash@^4.17.15` → `["^4.17.15"]`)
  - `OsvEvent = {introduced}|{fixed}|{last_affected}|{limit}`; `OsvRange {type: "SEMVER"|"ECOSYSTEM"|"GIT"; events: OsvEvent[]}`; `OsvAffected {package?: {ecosystem; name}; ranges?: OsvRange[]; versions?: string[]}`; `OsvRecord {id; modified; withdrawn?; aliases?; summary?; details?; severity?: {type: string; score: string}[]; affected?: OsvAffected[]; database_specific?: Record<string, unknown>}`
  - `Vuln`, `FixResult`, `TextEditSpec {uri; range; newText}`, `UpdatePlan {edit: TextEditSpec[]; lockCommand?: {cwd; command}; kind; widened?: boolean}` (*added* `widened`)
  - `Finding` per spec §5 plus *added* `key: string` and `checkedLowerBound: boolean`
  - `PackageQuery {ecosystem; name; version}`
- Produces (`versioning/types.ts`): `interface Comparator { isValid(v: string): boolean; compare(a: string, b: string): number; normalize(v: string): string; major(v: string): number }`
- Produces (`versioning/semver.ts`): `export const semverComparator: Comparator` (uses `semver` with `{loose: true}`; `normalize` strips a leading `v`/`=`)

- [ ] **Step 1: Scaffold the workspace**

Root `package.json`: `"private": true`, `"workspaces": ["packages/*"]`, scripts `test` (`vitest run`), `typecheck` (`tsc -p packages/osv-language-server --noEmit`), `lint` (`eslint .`), `build` (`npm run build --workspaces`). `vitest.config.ts` includes `packages/osv-language-server/test/**/*.test.ts`. `tsconfig.base.json`: `strict`, `module`/`moduleResolution` `NodeNext`, `target` `ES2022`, `noUncheckedIndexedAccess`. Server `package.json`: name `osv-language-server`, `engines.node ">=20"`, bins `osv-language-server` → `dist/server.js`, `osv-check` → `dist/cli.js`. Install deps listed in Tech Stack into the server package (runtime) and root (dev). `.gitignore`: `node_modules`, `dist`, `*.vsix`, `.vscode-test`.

- [ ] **Step 2: Write the failing test**

```ts
describe("semverComparator", () => {
  it.each([["1.2.3", "1.2.10", -1], ["v1.0.0", "1.0.0", 0], ["1.0.0-rc.1", "1.0.0", -1], ["2.0.0", "1.9.9", 1]])(
    "compare(%s, %s) = %i", (a, b, r) => expect(Math.sign(semverComparator.compare(a, b))).toBe(r));
  it("validates", () => { expect(semverComparator.isValid("1.2.3")).toBe(true); expect(semverComparator.isValid("latest")).toBe(false); });
  it("major", () => expect(semverComparator.major("v3.4.5")).toBe(3));
});
```

- [ ] **Step 3: Run it to verify it fails** — `npx vitest run packages/osv-language-server/test/versioning/semver.test.ts` → FAIL (module not found).
- [ ] **Step 4: Implement `types.ts`, `versioning/types.ts`, `semver.ts`.**
- [ ] **Step 5: Verify** — the test passes; `npm run typecheck` and `npm run lint` pass. (Until Task 23 the root `typecheck` script covers only `packages/osv-language-server`; Task 23 adds `packages/vscode-osv`.)
- [ ] **Step 6: Commit** — `git commit -m "chore: scaffold monorepo; add core types and semver comparator"`

---

### Task 2: LineIndex and dependency-graph helper

**Files:**
- Create: `src/core/lineIndex.ts`, `src/core/graph.ts`
- Test: `test/core/lineIndex.test.ts`, `test/core/graph.test.ts`

**Interfaces:**
- Produces: `class LineIndex { constructor(text: string); position(offset: number): Position; range(start: number, end: number): TextRange; offset(pos: Position): number }` — UTF-16 offsets (JS string indices); a `\r\n` terminator is not part of the line's characters.
- Produces: `computeVia(direct: Iterable<string>, edges: Map<string, string[]>): Map<string, string[]>` — BFS from each direct node; for every reachable non-direct node, the shortest path of *direct-first ancestors excluding the node itself* (e.g. `body-parser`'s via is `["express"]`; a node reached as `a → b → c` has via `["a", "b"]`). Nodes are opaque string keys.

- [ ] **Step 1: Write failing tests**

```ts
it("handles CRLF", () => { const ix = new LineIndex("a\r\nbc\r\nd"); expect(ix.position(3)).toEqual({ line: 1, character: 0 }); expect(ix.position(5)).toEqual({ line: 1, character: 2 }); expect(ix.offset({ line: 2, character: 0 })).toBe(7); });
it("handles a BOM as character 0 of line 0", () => expect(new LineIndex("﻿{}").position(1)).toEqual({ line: 0, character: 1 }));
it("computes shortest via paths", () => {
  const via = computeVia(["express"], new Map([["express", ["body-parser", "qs"]], ["body-parser", ["qs", "raw-body"]]]));
  expect(via.get("qs")).toEqual(["express"]); expect(via.get("raw-body")).toEqual(["express", "body-parser"]); expect(via.has("express")).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/osv-language-server/test/core` → FAIL.
- [ ] **Step 3: Implement** (`LineIndex` precomputes line-start offsets by scanning for `\n`; `position` binary-searches).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): add LineIndex and via-path graph helper"`

---

### Task 3: PEP 440 comparator and PyPI name normalization

**Files:**
- Create: `src/versioning/pep440.ts`, `src/ecosystems/pypi/names.ts`
- Test: `test/versioning/pep440.test.ts`, `test/ecosystems/pypi/names.test.ts`

**Interfaces:**
- Produces: `export const pep440Comparator: Comparator` (wraps `@renovatebot/pep440` `compare`/`valid`/`major`; `normalize` → `clean()` result or input).
- Produces: `normalizePypiName(name: string): string` — PEP 503: lowercase, runs of `[-_.]` → `-`.

- [ ] **Step 1: Write failing tests**

```ts
it.each([["1.0.dev1", "1.0a1", -1], ["1.0a1", "1.0rc1", -1], ["1.0rc1", "1.0", -1], ["1.0", "1.0.post1", -1], ["1.0", "1.0.0", 0], ["1!0.1", "2.0", 1]])(
  "compare(%s, %s) = %i", (a, b, r) => expect(Math.sign(pep440Comparator.compare(a, b))).toBe(r));
it("major", () => expect(pep440Comparator.major("2.31.0")).toBe(2));
it("normalizes names", () => expect(normalizePypiName("Zope.Interface__x")).toBe("zope-interface-x"));
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(versioning): add PEP 440 comparator and PyPI name normalization"`

---

### Task 4: Severity and alias merging

**Files:**
- Create: `src/core/severity.ts`, `src/core/aliases.ts`
- Test: `test/core/severity.test.ts`, `test/core/aliases.test.ts`

**Interfaces:**
- Produces: `severityOf(record: OsvRecord): Severity` — max over `severity[]` entries (`CVSS_V3` via `Cvss3P1`/`Cvss3P0` by vector prefix, `CVSS_V4` via `Cvss4P0`, `.calculateScores().overall`), else `database_specific.severity` (`CRITICAL`, `HIGH`, `MODERATE`|`MEDIUM`, `LOW`), else `"unknown"`. Unparseable vectors are ignored.
- Produces: `severityRank(s: Severity): number` (critical 4 … unknown 0) and `maxSeverity(list: Severity[]): Severity`.
- Produces: `mergeAliases(records: OsvRecord[]): Vuln[]` — union-find over each record's `id` + `aliases`; one `Vuln` per group; `id` is the preferred ID (Global Constraints order) among the group's record IDs; `aliases` = all other IDs (from both `id`s and `aliases`), sorted; `summary` from the preferred record (fallback first non-empty); `severity` = max over group; `modified` = latest. Result sorted by severity desc, then id.

- [ ] **Step 1: Write failing tests**

```ts
it("scores CVSS v3.1", () => expect(severityOf(rec({ severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }))).toBe("critical"));
it("scores CVSS v4", () => expect(severityOf(rec({ severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N" }] }))).toBe("medium"));
it("falls back to database_specific", () => expect(severityOf(rec({ database_specific: { severity: "MODERATE" } }))).toBe("medium"));
it("unknown otherwise", () => expect(severityOf(rec({}))).toBe("unknown"));
it("merges GHSA/PYSEC/CVE into one, preferring GHSA", () => {
  const v = mergeAliases([rec({ id: "PYSEC-2023-74", aliases: ["CVE-2023-32681", "GHSA-j8r2-6x86-q33q"] }), rec({ id: "GHSA-j8r2-6x86-q33q", aliases: ["CVE-2023-32681"] })]);
  expect(v).toHaveLength(1); expect(v[0].id).toBe("GHSA-j8r2-6x86-q33q"); expect(v[0].aliases).toEqual(["CVE-2023-32681", "PYSEC-2023-74"]);
});
```
(`rec(partial)` is a local helper filling `id`/`modified`.) Before writing the v4 expectation, compute the vector's score with `node -e` and pick a vector scoring 4.0–6.9.

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): add severity scoring and alias merging"`

---

### Task 5: Fix calculator

**Files:**
- Create: `src/core/fixCalculator.ts`
- Test: `test/core/fixCalculator.test.ts`, fixtures `test/fixtures/osv/` (downloaded real records + synthetic)

**Interfaces:**
- Consumes: `Comparator`, `OsvRecord`, `FixResult`.
- Produces: `calculateFix(records: OsvRecord[], ecosystem: string, name: string, current: string, cmp: Comparator, normalizeName: (n: string) => string): FixResult`
- Produces: `isAffected(records: OsvRecord[], ecosystem: string, name: string, version: string, cmp: Comparator, normalizeName: (n: string) => string): boolean`

Algorithm (spec §7.3) — the part the signature doesn't determine:

```
intervals(record) = for each affected entry matching ecosystem + normalizeName(name),
  for each SEMVER/ECOSYSTEM range: sort events by version ("0" lowest; ties: introduced first),
  walk: introduced opens; fixed closes exclusive (end=fixed); last_affected closes inclusive (end=undefined, lastAffected=v);
  an interval still open at the end is open-ended. "limit" events are ignored.
  An affected entry with only `versions` and no ranges yields point intervals [v, v] with no fix.
contains(iv, v) = v >= iv.start && (iv.fixed ? v < iv.fixed : iv.lastAffected ? v <= iv.lastAffected : true)

if !cmp.isValid(current): return {target: undefined, fixesAll: false, crossesMajor: false, reason: "unparseable-version"}
fixPoints = []
for record: iv = interval containing current
  if iv && !iv.fixed: return {target: undefined, ..., reason: "no-fixed-event"}
  if iv: fixPoints.push(iv.fixed)
  else: f = lowest interval.fixed > current; if none return {..., reason: "no-matching-range"}; fixPoints.push(f)
candidate = max(fixPoints)        (no records → target undefined, fixesAll true, no reason)
while some interval (any record) contains candidate:
  if it has no fixed: return {..., reason: "no-fixed-event"}
  candidate = that interval's fixed
return {target: candidate, fixesAll: true, crossesMajor: cmp.major(candidate) > cmp.major(current)}
```
Unparseable event versions are skipped.

- [ ] **Step 1: Download real fixtures**

```bash
mkdir -p packages/osv-language-server/test/fixtures/osv
for id in GHSA-p6mc-m468-83gw GHSA-29mw-wpgm-hmr9 GHSA-35jh-r3h4-6jhm GHSA-j8r2-6x86-q33q PYSEC-2023-74; do
  curl -sf "https://api.osv.dev/v1/vulns/$id" -o "packages/osv-language-server/test/fixtures/osv/$id.json"; done
```

- [ ] **Step 2: Write failing tests**

```ts
it("lodash 4.17.15 with three real records → 4.17.21", () =>
  expect(calculateFix(load("GHSA-p6mc-m468-83gw", "GHSA-29mw-wpgm-hmr9", "GHSA-35jh-r3h4-6jhm"), "npm", "lodash", "4.17.15", semverComparator, id).target).toBe("4.17.21"));
it("backport: picks the fix in the current branch", () =>
  expect(calc([range({ introduced: "0" }, { fixed: "1.2.5" }, { introduced: "2.0.0" }, { fixed: "2.1.0" })], "1.2.0").target).toBe("1.2.5"));
it("last_affected only → no fix", () =>
  expect(calc([range({ introduced: "0" }, { last_affected: "1.9.0" })], "1.0.0")).toMatchObject({ target: undefined, reason: "no-fixed-event" }));
it("target itself affected by another record → advances", () =>
  expect(calc([range({ introduced: "0" }, { fixed: "1.5.0" })], "1.0.0", [range({ introduced: "1.5.0" }, { fixed: "1.6.0" })]).target).toBe("1.6.0"));
it("flags major upgrades", () => expect(calc([range({ introduced: "0" }, { fixed: "2.0.0" })], "1.4.0").crossesMajor).toBe(true));
it("ignores GIT ranges and other packages", () => expect(calc([gitRange()], "1.0.0").reason).toBe("no-matching-range"));
it("unparseable current", () => expect(calc([range({ introduced: "0" }, { fixed: "1.0.0" })], "not-a-version").reason).toBe("unparseable-version"));
it("isAffected", () => expect(isAffected(load("GHSA-29mw-wpgm-hmr9"), "npm", "lodash", "4.17.21", semverComparator, id)).toBe(false));
```
(`calc(rangesForRecord1, current, rangesForRecord2?)` builds synthetic npm records for package `pkg`.)

- [ ] **Step 3–5: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 6: Commit** — `git commit -m "feat(core): add OSV fix calculator"`

---

### Task 6: Settings, ignores, cache directory, disk cache

**Files:**
- Create: `src/core/settings.ts`, `src/core/ignores.ts`, `src/core/cacheDir.ts`, `src/core/cache.ts`, `src/core/fileSource.ts`
- Test: `test/core/settings.test.ts`, `test/core/ignores.test.ts`, `test/core/cache.test.ts`

**Interfaces:**
- Produces: `interface Settings { enable: boolean; ecosystems: Record<string, boolean>; minimumSeverity: "low"|"medium"|"high"|"critical"; scanLockfiles: boolean; scanWorkspaceOnStartup: boolean; cacheTtlHours: number; apiBaseUrl: string; ignoredVulnerabilities: string[]; offerLockCommand: "ask"|"always"|"never" }`, `DEFAULT_SETTINGS` (values from spec §12), `normalizeSettings(raw: unknown): Settings` (unknown keys ignored, wrong types → default, `cacheTtlHours` clamped to ≥ 1, trailing `/` stripped from `apiBaseUrl`), `isEcosystemEnabled(s: Settings, moduleId: string): boolean` (missing key → true).
- Produces: `class IgnoreMatcher { constructor(ids: string[], tomlEntries: IgnoreEntry[], now: Date); isIgnored(vuln: Vuln): boolean }` — matches `vuln.id` or any alias; `IgnoreEntry {id; ignoreUntil?: Date; reason?}`; expired entries don't apply.
- Produces: `parseOsvScannerToml(text: string): IgnoreEntry[]` (`toml-eslint-parser` `parseTOML` + `getStaticTOMLValue`; reads `[[IgnoredVulns]]` `id`, `ignoreUntil`, `reason`; invalid TOML → `[]`).
- Produces (`core/fileSource.ts`, created in this task): `interface FileSource { read(path: string): Promise<string | undefined> }` and `nodeFileSource: FileSource` (reads via `fs.promises.readFile`; `undefined` on ENOENT/EISDIR).
- Produces: `findOsvScannerToml(filePath: string, rootDir: string, files: FileSource): Promise<string | undefined>` — path of the nearest `osv-scanner.toml` from the file's directory up to `rootDir` inclusive.
- Produces: `defaultCacheDir(platform = process.platform, env = process.env, home = os.homedir()): string` — paths per spec §9; `OSV_CACHE_DIR` overrides.
- Produces: `class DiskCache { constructor(dir: string, memoryEntries = 5000); getPackage(q: PackageQuery): Promise<PackageEntry | undefined>; putPackage(q: PackageQuery, e: PackageEntry): Promise<void>; getVuln(id: string): Promise<OsvRecord | undefined>; putVuln(r: OsvRecord): Promise<void>; clear(): Promise<void>; housekeep(ttlHours: number, now?: Date): Promise<number> }` where `PackageEntry { fetchedAt: string; vulnIds: { id: string; modified: string }[] }`. File layout `pkg/<sha256(ecosystem|name|version)>.json`, `vuln/<sha256(id)>.json`. Writes: `mkdir -p`, write `<file>.<pid>.<random>.tmp`, `rename`. Corrupt JSON → treated as a miss. In-memory LRU in front.
- Produces: `isFresh(e: PackageEntry, ttlHours: number, now?: Date): boolean`.

- [ ] **Step 1: Write failing tests**

```ts
it("defaults and clamps", () => { expect(normalizeSettings({ cacheTtlHours: 0 }).cacheTtlHours).toBe(1); expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS); expect(DEFAULT_SETTINGS.cacheTtlHours).toBe(48); });
it("ignores by alias and respects ignoreUntil", () => {
  const m = new IgnoreMatcher(["CVE-1"], parseOsvScannerToml('[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = 2020-01-01\n'), new Date("2026-10-18"));
  expect(m.isIgnored(vuln("GHSA-a", ["CVE-1"]))).toBe(true); expect(m.isIgnored(vuln("GHSA-x", []))).toBe(false);
});
it("linux cache dir honours XDG", () => expect(defaultCacheDir("linux", { XDG_CACHE_HOME: "/c" }, "/h")).toBe("/c/osv-language-server"));
it("round-trips and expires", async () => { const c = new DiskCache(tmp()); await c.putPackage(q, entry("2026-10-16T00:00:00Z")); expect(isFresh((await c.getPackage(q))!, 48, new Date("2026-10-17T23:00:00Z"))).toBe(true); expect(isFresh((await c.getPackage(q))!, 48, new Date("2026-10-18T01:00:00Z"))).toBe(false); });
it("survives concurrent writers", async () => { /* spawn 2 child processes (node -e via tsx) writing the same key 50× each; afterwards the file parses and no *.tmp remain */ });
it("treats corrupt files as a miss", async () => { /* write garbage to the hashed path; getPackage → undefined */ });
it("housekeep removes entries older than 7×TTL", async () => { /* entry fetched 15 days ago, ttl 48h → removed; count === 1 */ });
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): add settings, ignores, and shared disk cache"`

---

### Task 7: OSV HTTP client and OSV service

**Files:**
- Create: `src/core/osvClient.ts`, `src/core/osvService.ts`
- Create: `test/helpers/fakeOsv.ts`
- Test: `test/core/osvClient.test.ts`, `test/core/osvService.test.ts`

**Interfaces:**
- Produces: `class OsvClient { constructor(opts: { baseUrl: string; userAgent: string; dispatcher?: Dispatcher; sleep?: (ms: number) => Promise<void> }); queryBatch(queries: PackageQuery[], signal?: AbortSignal): Promise<{ id: string; modified: string }[][]>; getVuln(id: string, signal?: AbortSignal): Promise<OsvRecord> }` — uses `undici.fetch`; default dispatcher `new EnvHttpProxyAgent()`; chunks of 1000; per-query `next_page_token` pagination (re-query that package with `page_token`, append); serialises batch calls through an internal promise chain; `getVuln` concurrency capped at 8 via an internal semaphore; retries per Global Constraints (`Retry-After` seconds or HTTP date); throws `OsvUnavailableError` after final failure. Request body: `{queries: [{package: {name, ecosystem}, version}]}`.
- Produces: `class OsvService { constructor(client: OsvClient, cache: DiskCache, getTtlHours: () => number); lookup(queries: PackageQuery[], signal?: AbortSignal): Promise<{ results: Map<string, { records: OsvRecord[]; cached: boolean }>; offline: boolean }> }` and `queryKey(q: PackageQuery): string` = `` `${ecosystem}|${name}|${version}` ``. Behaviour: dedupe; fresh cache hits skip the network; misses + stale go to `queryBatch`; vuln records fetched only when absent from cache or `modified` differs; withdrawn records dropped from results; on `OsvUnavailableError`, serve stale entries with `cached: true` and set `offline: true`; queries with neither network nor cache are absent from `results`.
- Produces (test helper): `startFakeOsv(data: { packages: Record<string, string[]>; records: Record<string, OsvRecord> }): Promise<{ url: string; requests: { path: string; body: unknown }[]; failNext(status: number, times: number, retryAfter?: string): void; close(): Promise<void> }>` — Node `http` server on port 0 implementing both endpoints from `data` (key = `queryKey`). Used by Tasks 7, 21, 22, 23.

- [ ] **Step 1: Write failing tests**

```ts
it("chunks at 1000 and maps results in order", async () => { /* 1500 queries → fake sees 2 querybatch requests with 1000 and 500 queries */ });
it("follows next_page_token", async () => { /* MockAgent returns token on first page; second call includes page_token; ids concatenated */ });
it("retries 429 honouring Retry-After then succeeds", async () => { /* failNext(429, 2, "1"); injected sleep records [1000, 1000]; result ok */ });
it("throws OsvUnavailableError after 3 failures", async () => {});
it("caps getVuln concurrency at 8", async () => { /* fake tracks max in-flight */ });
it("serves fresh cache without network", async () => {});
it("refetches a vuln only when modified changes", async () => {});
it("drops withdrawn records", async () => { /* record with withdrawn: "2024-01-01T00:00:00Z" → not in results */ });
it("offline: stale cache served with cached=true", async () => {});
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): add OSV client with batching/retry and cached OSV service"`

---

### Task 8: Ecosystem module contract and JSON edit helper

**Files:**
- Create: `src/ecosystems/types.ts`, `src/ecosystems/index.ts`, `src/ecosystems/jsonEdit.ts`
- Test: `test/ecosystems/index.test.ts`, `test/ecosystems/jsonEdit.test.ts`

**Interfaces:**
- Produces (`ecosystems/types.ts`):
  ```ts
  interface RewriteResult { spec: string; widened: boolean }
  interface LockCtx { manifestPath: string; lockfilePath?: string; name: string; target: string }
  interface TransitiveCtx { name: string; target: string; lockfilePath: string; manifestPath?: string; manifestUri?: string; manifestText?: string }
  interface EcosystemModule {
    id: string; osvEcosystem: string;
    manifests: string[]; lockfiles: string[];             // picomatch globs matched against the path relative to the root, prefixed with "**/"
    lockfilesForManifest(manifestBasename: string): string[];   // basenames, preference order
    manifestForLockfile(lockfileBasename: string): string | undefined;  // basename
    versioning: Comparator;
    normalizeName(name: string): string;
    parseManifest(text: string, fileName: string): DeclaredDep[];   // throws ParseError on invalid syntax
    parseLockfile(text: string, fileName: string): ResolvedDep[];   // throws ParseError on invalid syntax
    rewriteSpec(rawSpec: string, target: string): RewriteResult;
    lockCommand(ctx: LockCtx): string | undefined;
    transitiveFix(ctx: TransitiveCtx): UpdatePlan | undefined;
  }
  class ParseError extends Error {}
  ```
- Produces (`index.ts`): `ALL_MODULES: EcosystemModule[]` (empty now; npm/pypi appended in Tasks 11 and 15), `classifyFile(relPath: string, modules?: EcosystemModule[]): { module: EcosystemModule; role: "manifest" | "lockfile" } | undefined` (manifest patterns win; uses `picomatch` with `{dot: true}`), `registerModule(m)` for tests.
- Produces (`jsonEdit.ts`): `setJsonProperty(text: string, path: (string | number)[], value: unknown, uri: string): TextEditSpec[]` — wraps `jsonc-parser` `modify` with `{formattingOptions: {insertSpaces: true, tabSize: detected indent (2 default), eol: detected}}`, converting offset edits to `TextEditSpec` via `LineIndex`.

- [ ] **Step 1: Write failing tests**

```ts
it("classifies by glob, manifest first", () => { registerModule(fake({ id: "x", manifests: ["requirements*.txt"], lockfiles: ["x.lock"] })); expect(classifyFile("a/b/requirements-dev.txt")?.role).toBe("manifest"); expect(classifyFile("x.lock")?.role).toBe("lockfile"); expect(classifyFile("README.md")).toBeUndefined(); });
it("adds a nested property preserving 4-space indent", () => {
  const text = '{\n    "name": "a"\n}\n';
  expect(applyEdits(text, setJsonProperty(text, ["overrides", "qs"], "6.10.3", "u"))).toBe('{\n    "name": "a",\n    "overrides": {\n        "qs": "6.10.3"\n    }\n}\n');
});
```
(`applyEdits` is a test helper that applies `TextEditSpec[]` via `LineIndex.offset`; put it in `test/helpers/applyEdits.ts` for reuse.)

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(ecosystems): add module contract, file classification, JSON edit helper"`

---

### Task 9: npm — package.json parser and spec rewriting

**Files:**
- Create: `src/ecosystems/npm/manifest.ts`, `src/ecosystems/npm/rewrite.ts`
- Test: `test/ecosystems/npm/manifest.test.ts`, `test/ecosystems/npm/rewrite.test.ts`, fixtures `test/fixtures/npm/`

**Interfaces:**
- Produces: `parseNpmManifest(text: string): DeclaredDep[]` — groups `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`; `nameRange` = the key string's content (excluding quotes), `specRange` = value string content. Kind: `file:`/`link:`/`workspace:` → `path`; `git+`, `git:`, `github:`, `user/repo`, `*.git` → `git`; `http(s):` → `url`; `npm:<name>@<spec>` alias → `registry` with `name` = aliased package and `rawSpec`/`specRange` = the part after the last `@`; `*`, `latest`, `x`, empty → `unresolved`. `lowerBound` = `semver.minVersion(spec, {loose: true})`, treating `0.0.0` (unless spec is literally `0.0.0`) or a throw as `undefined` → kind `unresolved`. Invalid JSON → `ParseError` (use `jsonc-parser` `parseTree` with error collection; a root that is not an object is also a `ParseError`).
- Produces: `rewriteNpmSpec(raw: string, target: string): RewriteResult` — preserve the leading operator of the comparator that sets the minimum (`^`, `~`, `>=`, `=`, `v`, none); for `>=A <B` keep `<B` unless `target >= B`, then drop the upper bound and set `widened: true`; for `||` unions replace the whole spec with `^target` and `widened: true`; `x`-ranges (`1.2.x`) → same shape with target's major/minor (`1.4.x`) only when the target's patch is 0, otherwise `~target` (a rewritten spec must never admit versions below the target).

- [ ] **Step 1: Write failing tests**

```ts
it("parses all groups with exact ranges, CRLF + BOM safe", () => {
  const text = "﻿{\r\n  \"dependencies\": { \"lodash\": \"^4.17.15\" },\r\n  \"devDependencies\": { \"lodash\": \"4.17.10\" }\r\n}";
  const deps = parseNpmManifest(text);
  expect(deps.map(d => [d.name, d.group, d.lowerBound])).toEqual([["lodash", "dependencies", "4.17.15"], ["lodash", "devDependencies", "4.17.10"]]);
  expect(deps[0].specRange).toEqual({ start: { line: 1, character: 31 }, end: { line: 1, character: 39 } });
});
it("classifies kinds", () => expect(kinds({ a: "file:../a", b: "github:u/r", c: "https://x/t.tgz", d: "*", e: "npm:lodash@^4.17.0" })).toEqual([["a", "path"], ["b", "git"], ["c", "url"], ["d", "unresolved"], ["lodash", "registry"]]));
it("treats <2.0.0 as unresolved", () => expect(kinds({ a: "<2.0.0" })).toEqual([["a", "unresolved"]]));
it("throws ParseError on invalid JSON", () => expect(() => parseNpmManifest('{"dependencies": {')).toThrow(ParseError));
it.each([["^1.2.3", "1.4.0", "^1.4.0", false], ["~1.2.3", "1.4.0", "~1.4.0", false], ["1.2.3", "1.4.0", "1.4.0", false], [">=1.2.3 <2", "1.4.0", ">=1.4.0 <2", false], [">=1.2.3 <2", "2.1.0", ">=2.1.0", true], ["1.2.x", "1.4.0", "1.4.x", false], ["1.2.x", "1.4.3", "~1.4.3", false], ["^1.0.0 || ^2.0.0", "2.3.0", "^2.3.0", true]])(
  "rewrite %s → %s", (raw, t, spec, widened) => expect(rewriteNpmSpec(raw, t)).toEqual({ spec, widened }));
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(npm): parse package.json and rewrite specs preserving style"`

---

### Task 10: npm — lockfile parsers

**Files:**
- Create: `src/ecosystems/npm/packageLock.ts`, `bunLock.ts`, `yarnLock.ts`, `pnpmLock.ts`
- Test: one test file per parser under `test/ecosystems/npm/`, fixtures in `test/fixtures/npm/` (generate each real lockfile once with the real tool from a fixture `package.json` depending on `express@4.17.1` and `lodash@4.17.15`; commit them)

**Interfaces:**
- Consumes: `LineIndex`, `computeVia`, `ParseError`.
- Produces: `parsePackageLock(text): ResolvedDep[]` (lockfileVersion 2/3 `packages`; skip `""` root and `link: true`; name = last `node_modules/<name>` segment (scoped-aware); direct = top-level `node_modules/<name>` present in root `dependencies`/`devDependencies`/`optionalDependencies`; edges from each entry's dependency maps resolved node-style (nearest ancestor `node_modules`); range = the `"version"` value content; lockfileVersion 1 → recursive `dependencies` tree, same output), `parseBunLock(text)` (JSONC with trailing commas via `jsonc-parser`; `packages` values are arrays whose first element is `"name@version"`; range = that string's version part), `parseYarnLock(text)` (v1 line format and berry YAML (`__metadata` present → YAML via `yaml`); keys `name@spec[, name@spec2]` → `requestedSpecs`; berry `npm:` prefixes stripped; range = the `version` value; edges from `dependencies` blocks), `parsePnpmLock(text)` (YAML; lockfile v6 keys `/name@version` and v9 keys `name@version` in `packages`/`snapshots`; direct + `requestedSpecs` from `importers['.']` `specifier`/`version`; range = the key's version part).
- All parsers set `via` from `computeVia` where edges exist.

- [ ] **Step 1: Generate and commit fixtures** — in a temp dir: `npm install`, `yarn install` (v1 and berry), `pnpm install`, `bun install` with the fixture manifest; copy lockfiles to `test/fixtures/npm/{package-lock.json,yarn-v1.lock,yarn-berry.lock,pnpm-v9.yaml,bun.lock}`. Also hand-write a minimal `pnpm-v6.yaml`.
- [ ] **Step 2: Write failing tests** (one block per parser, same assertions):

```ts
it("finds direct and transitive entries with via", () => {
  const deps = parsePackageLock(read("package-lock.json"));
  expect(deps.find(d => d.name === "lodash")).toMatchObject({ version: "4.17.15", direct: true });
  expect(deps.find(d => d.name === "body-parser")).toMatchObject({ direct: false, via: ["express"] });
  const r = deps.find(d => d.name === "lodash")!.range; expect(textAt(read("package-lock.json"), r)).toBe("4.17.15");
});
it("keeps nested duplicate versions as separate entries", () => { /* hand-written lock with node_modules/a and node_modules/b/node_modules/a at two versions → both present with distinct ranges */ });
it("parses a 5,000-entry lockfile in < 250 ms", () => { /* generated text; performance.now() delta */ });
it("throws ParseError on truncated input", () => {});
// yarn: requestedSpecs equals ["^4.17.15"] for lodash; pnpm: direct from importers; bun: version range points at "4.17.15"
```

- [ ] **Step 3–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(npm): parse package-lock, yarn, pnpm and bun lockfiles"`

---

### Task 11: npm module assembly

**Files:**
- Create: `src/ecosystems/npm/index.ts`; Modify: `src/ecosystems/index.ts` (add to `ALL_MODULES`)
- Test: `test/ecosystems/npm/module.test.ts`

**Interfaces:**
- Produces: `export const npmModule: EcosystemModule` with `id "npm"`, `osvEcosystem "npm"`, `manifests ["package.json"]` (paths containing `/node_modules/` are excluded by `classifyFile`'s caller — see Task 18), `lockfiles ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock"]`, `lockfilesForManifest("package.json")` = `["npm-shrinkwrap.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]`, `manifestForLockfile` → `"package.json"`, `normalizeName` identity, `versioning semverComparator`.
- `lockCommand`: by lockfile basename — package-lock/shrinkwrap/none → `npm install`; yarn → `yarn install`; pnpm → `pnpm install`; bun → `bun install`.
- `transitiveFix`: requires `manifestText`/`manifestUri`; edit via `setJsonProperty` at `["overrides", name]` (npm, bun), `["resolutions", name]` (yarn), `["pnpm", "overrides", name]` (pnpm) with value `target`; `lockCommand` as above with `cwd` = lockfile dir; `kind: "override"`. Without manifest text → `undefined`.

- [ ] **Step 1: Write failing tests**

```ts
it("lock commands by lockfile", () => expect(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", undefined].map(l => npmModule.lockCommand({ manifestPath: "/p/package.json", lockfilePath: l && `/p/${l}`, name: "x", target: "1.0.0" }))).toEqual(["npm install", "yarn install", "pnpm install", "bun install", "npm install"]));
it("pnpm override edit", () => { const plan = npmModule.transitiveFix({ name: "qs", target: "6.10.3", lockfilePath: "/p/pnpm-lock.yaml", manifestUri: "file:///p/package.json", manifestText: "{}" })!; expect(JSON.parse(applyEdits("{}", plan.edit))).toEqual({ pnpm: { overrides: { qs: "6.10.3" } } }); expect(plan).toMatchObject({ kind: "override", lockCommand: { cwd: "/p", command: "pnpm install" } }); });
it("registered", () => expect(classifyFile("app/package.json")?.module.id).toBe("npm"));
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(npm): assemble npm ecosystem module"`

---

### Task 12: PyPI — requirement strings, requirements.txt, spec rewriting

**Files:**
- Create: `src/ecosystems/pypi/requirement.ts`, `requirements.ts`, `rewrite.ts`
- Test: `test/ecosystems/pypi/requirement.test.ts`, `requirements.test.ts`, `rewrite.test.ts`

**Interfaces:**
- Produces: `parseRequirement(s: string): { name: string; nameStart: number; nameEnd: number; spec?: string; specStart?: number; specEnd?: number; kind: DepKind } | undefined` — PEP 508 subset: name, optional `[extras]` (skipped), optional specifier set (`(…)` parens allowed), `; markers` (stripped), `name @ url` → kind `url` (`git+` → `git`, `file:` → `path`). Offsets relative to `s`.
- Produces: `pep440LowerBound(spec: string): string | undefined` — from `specifier.parse`: the highest of `==X` (non-wildcard), `===X`, `>=X`, `~=X`; `==X.*` → `X` (e.g. `1.2`); only `>`/`<`/`<=`/`!=` → `undefined`.
- Produces: `parseRequirementsTxt(text: string): DeclaredDep[]` — joins `\` continuations (ranges still map to original offsets), strips `#` comments (when preceded by whitespace or at line start), skips option lines (`-r`, `-c`, `-e`, `--index-url`, …) and trailing `--hash=` options; names normalized with `normalizePypiName`; `nameRange`/`specRange` from `parseRequirement` offsets; kind `unresolved` when no lower bound.
- Produces: `rewritePep440Spec(raw: string, target: string): RewriteResult` — replace the version of the clause that sets the lower bound (`==`, `===`, `>=`, `~=`, `==X.*` → `==T'.*` with the same segment count when the dropped segments of the target are all 0, otherwise `~=T`; a rewritten spec must never admit versions below the target); drop any `<`/`<=` clause the target violates (`widened: true`); `!=` clauses are left untouched.

- [ ] **Step 1: Write failing tests**

```ts
it("parses names, extras, markers, URLs, CRLF", () => {
  const deps = parseRequirementsTxt("Requests[security]>=2.0,<3 ; python_version>'3.8'  # c\r\n-r base.txt\r\nflask==2.0.1 \\\r\n  --hash=sha256:abc\r\npkg @ git+https://x/y.git\r\n");
  expect(deps.map(d => [d.name, d.rawSpec, d.lowerBound, d.kind])).toEqual([["requests", ">=2.0,<3", "2.0", "registry"], ["flask", "==2.0.1", "2.0.1", "registry"], ["pkg", undefined, undefined, "git"]]);
  expect(deps[1].specRange).toEqual({ start: { line: 2, character: 5 }, end: { line: 2, character: 12 } });
});
it.each([[">=2.0", "2.0"], ["~=2.2", "2.2"], ["==1.2.*", "1.2"], ["<3", undefined], [">=1.0,!=1.5", "1.0"]])("lower bound %s", (s, lb) => expect(pep440LowerBound(s)).toBe(lb));
it.each([["==2.0", "2.5", "==2.5", false], [">=2.0,<3", "2.5", ">=2.5,<3", false], [">=2.0,<3", "3.1", ">=3.1", true], ["~=2.0", "2.5", "~=2.5", false], ["==1.2.*", "1.4.0", "==1.4.*", false], ["==1.2.*", "1.4.2", "~=1.4.2", false]])(
  "rewrite %s → %s", (raw, t, spec, widened) => expect(rewritePep440Spec(raw, t)).toEqual({ spec, widened }));
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(pypi): parse requirements.txt and rewrite PEP 440 specifiers"`

---

### Task 13: PyPI — pyproject.toml and Pipfile

**Files:**
- Create: `src/ecosystems/pypi/pyproject.ts`, `src/ecosystems/pypi/pipfile.ts`, `src/ecosystems/pypi/toml.ts` (shared AST helpers)
- Test: `test/ecosystems/pypi/pyproject.test.ts`, `pipfile.test.ts`

**Interfaces:**
- Produces (`toml.ts`): `parseTomlAst(text: string)` (throws `ParseError`), `stringContentRange(node): [number, number]` (basic/literal strings: `range[0]+1 … range[1]-1`; multi-line: `+3 … -3`), `tablesByKey(ast): Map<string, TOMLTable[]>` keyed by `resolvedKey.join(".")`.
- Produces: `parsePyproject(text: string): DeclaredDep[]` covering
  - PEP 621: `[project].dependencies` (array of PEP 508 strings), `[project.optional-dependencies].<group>`; PEP 735 `[dependency-groups].<group>` (strings only; `{include-group}` tables skipped); `[tool.uv].dev-dependencies`.
  - Poetry: `[tool.poetry.dependencies]` (skip `python`), `[tool.poetry.dev-dependencies]`, `[tool.poetry.group.<g>.dependencies]`; value is a string spec, or an inline table with `version` (`git`/`path`/`url` keys → that kind). Poetry spec lower bound via `poetryLowerBound(spec)`: `^X`/`~X`/`X` (bare = `^X`)/`>=X`/`==X` → `X`; `*` → `undefined`; comma-separated → use `pep440LowerBound` after mapping.
  - For PEP 508 strings, `nameRange`/`specRange` = string content start + `parseRequirement` offsets.
- Produces: `parsePipfile(text: string): DeclaredDep[]` — `[packages]` and `[dev-packages]`; `"*"` → `unresolved`; `{version = "..."}` tables; `{git = ...}`/`{path = ...}` kinds.
- Produces: `rewritePoetrySpec(raw: string, target: string): RewriteResult` — keeps `^`/`~`/bare/`>=`/`==` style with the target's version (Poetry caret semantics); comma ranges delegate to `rewritePep440Spec`.

- [ ] **Step 1: Write failing tests**

```ts
it("PEP 621 + optional + dependency-groups + uv dev", () => expect(names(parsePyproject(read("pep621.toml")))).toEqual([["requests", "dependencies", "2.25.0"], ["pytest", "test", "7.0"], ["ruff", "dev", "0.1.0"], ["black", "uv-dev", "22.1.0"]]));
it("Poetry string, table, group, git; skips python", () => expect(names(parsePyproject(read("poetry.toml")))).toEqual([["flask", "dependencies", "2.0.0"], ["django", "dependencies", "3.2"], ["pytest", "group.test", "6.0"], ["mylib", "dependencies", undefined /* git */]]));
it("specRange points inside the TOML string", () => { const t = '[project]\ndependencies = ["requests>=2.0"]\n'; expect(textAt(t, parsePyproject(t)[0].specRange!)).toBe(">=2.0"); });
it("Pipfile", () => expect(names(parsePipfile('[packages]\nrequests = "==2.25.0"\nflask = "*"\n[dev-packages]\npytest = {version = ">=6.0"}\n'))).toEqual([["requests", "packages", "2.25.0"], ["flask", "packages", undefined], ["pytest", "dev-packages", "6.0"]]));
it.each([["^2.0", "2.3.1", "^2.3.1"], ["~1.4", "1.6.0", "~1.6.0"], ["2.0", "2.3.1", "2.3.1"]])("poetry rewrite %s", (raw, t, spec) => expect(rewritePoetrySpec(raw, t).spec).toBe(spec));
it("throws ParseError on invalid TOML", () => expect(() => parsePyproject("[project\n")).toThrow(ParseError));
```
(Group labels: PEP 621 main → `"dependencies"`, optional → group name, dependency-groups → group name, uv → `"uv-dev"`, Poetry main → `"dependencies"`, Poetry dev → `"dev"`, Poetry groups → `"group.<g>"`. Write fixtures `pep621.toml`/`poetry.toml` to match.)

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(pypi): parse pyproject.toml (PEP 621/735, Poetry, uv) and Pipfile"`

---

### Task 14: PyPI — lockfile parsers

**Files:**
- Create: `src/ecosystems/pypi/poetryLock.ts`, `uvLock.ts`, `pipfileLock.ts`, `pdmLock.ts`, `pylock.ts`
- Test: one test per parser, fixtures generated with the real tools from a manifest depending on `requests==2.25.0` and `flask==2.0.1`

**Interfaces:**
- Produces: `parsePoetryLock`, `parseUvLock`, `parsePdmLock`, `parsePylock` (all TOML `[[package]]` arrays with `name`, `version`; range = version string content; edges from `[package.dependencies]` keys (poetry), `dependencies = [{name=…}]` (uv, pylock), `dependencies = ["name>=…"]` (pdm); uv/pylock direct from the root/editable/virtual package's dependencies; poetry/pdm `direct: false` — the scanner (Task 17) marks direct by manifest cross-reference), `parsePipfileLock` (JSON `default` + `develop`, `"==X"` version; range = the content after `==`; `direct: false`). Names normalized with `normalizePypiName`; `via` via `computeVia` where direct nodes are known.

- [ ] **Step 1: Generate fixtures** with `poetry lock`, `uv lock`, `pipenv lock`, `pdm lock`, `uv export --format pylock.toml` (or `pip lock`); commit under `test/fixtures/pypi/`.
- [ ] **Step 2: Write failing tests** — per parser: `requests` at `2.25.0` with range text `"2.25.0"`; `urllib3` present as a transitive dependency (uv/pylock: `via: ["requests"]`); truncated input → `ParseError`.
- [ ] **Step 3–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(pypi): parse poetry, uv, Pipfile, pdm and pylock lockfiles"`

---

### Task 15: PyPI module assembly

**Files:**
- Create: `src/ecosystems/pypi/index.ts`; Modify: `src/ecosystems/index.ts`
- Test: `test/ecosystems/pypi/module.test.ts`

**Interfaces:**
- Produces: `export const pypiModule: EcosystemModule` — `id "pypi"`, `osvEcosystem "PyPI"`, `manifests ["requirements*.txt", "requirements/*.txt", "pyproject.toml", "Pipfile"]`, `lockfiles ["poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock", "pylock.toml", "pylock.*.toml"]`, `lockfilesForManifest`: `pyproject.toml` → `["uv.lock", "poetry.lock", "pdm.lock", "pylock.toml"]`, `Pipfile` → `["Pipfile.lock"]`, otherwise `[]`; `manifestForLockfile`: `Pipfile.lock` → `Pipfile`, others → `pyproject.toml`; dispatch `parseManifest`/`parseLockfile` by basename; `rewriteSpec` → Poetry style when the spec starts with `^`, `~` (not `~=`) or is a bare version, else `rewritePep440Spec`; `normalizeName normalizePypiName`; `versioning pep440Comparator`.
- `lockCommand`: `uv.lock` → `uv lock`; `poetry.lock` → `poetry lock`; `Pipfile.lock` → `pipenv lock`; `pdm.lock` → `pdm lock`; no lockfile and manifest is `requirements*.txt` → `pip install -r <manifest basename>`; otherwise `undefined`.
- `transitiveFix`: `poetry.lock` → `{kind: "command-only", edit: [], lockCommand: "poetry update <name>"}`; `uv.lock` → `uv lock --upgrade-package <name>`; others → `undefined` (advice only).

- [ ] **Step 1: Write failing tests** for each `lockCommand`/`transitiveFix` mapping above, `rewriteSpec` dispatch (`"^2.0"` vs `">=2.0"`), and `classifyFile("svc/requirements-dev.txt")?.module.id === "pypi"`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(pypi): assemble PyPI ecosystem module"`

---

### Task 16: Lockfile resolution

**Files:**
- Create: `src/core/lockfileResolver.ts`; Modify: `src/core/fileSource.ts` (add `overlayFileSource`)
- Test: `test/core/lockfileResolver.test.ts`

**Interfaces:**
- Produces: `overlayFileSource(open: (path: string) => string | undefined, base: FileSource): FileSource` — open-document text wins over disk.
- Produces: `findLockfile(manifestPath: string, module: EcosystemModule, rootDir: string, files: FileSource): Promise<{ path: string; text: string } | undefined>` — for each directory from the manifest's up to `rootDir` (inclusive, never above), try `lockfilesForManifest(basename)` in order; first readable wins.
- Produces: `findManifestForLockfile(lockfilePath: string, module: EcosystemModule, files: FileSource): Promise<{ path: string; text: string } | undefined>` — same directory only.
- Produces: `resolveVersion(dep: DeclaredDep, locked: ResolvedDep[] | undefined, module: EcosystemModule): { version: string; fromLockfile: boolean } | undefined` — among locked entries with `normalizeName` equal: (1) `direct: true`; (2) `requestedSpecs` includes `dep.rawSpec`; (3) exactly one entry; else fall back to `dep.lowerBound` (`fromLockfile: false`); `kind !== "registry"` → `undefined`.

- [ ] **Step 1: Write failing tests**

```ts
it("walks up to the root but not beyond", async () => {
  const files = memFiles({ "/ws/package-lock.json": lock, "/package-lock.json": other });
  expect((await findLockfile("/ws/pkgs/a/package.json", npmModule, "/ws", files))?.path).toBe("/ws/package-lock.json");
  expect(await findLockfile("/ws2/package.json", npmModule, "/ws2", files)).toBeUndefined();
});
it("prefers direct, then requestedSpecs, then single entry, then lower bound", () => { /* four cases */ });
it("open document text overrides disk", async () => {});
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): resolve manifest versions through lockfiles"`

---

### Task 17: Document scanner

**Files:**
- Create: `src/core/scanner.ts`, `src/core/findingKey.ts`
- Test: `test/core/scanner.test.ts`

**Interfaces:**
- Consumes: Tasks 4–8, 11, 15, 16.
- Produces:
  ```ts
  interface ScanContext { files: FileSource; osv: { lookup: OsvService["lookup"] }; settings: Settings; ignores: IgnoreMatcher; rootDir: string; modules?: EcosystemModule[] }
  interface PreparedScan { queries: PackageQuery[]; finalize(results: Map<string, { records: OsvRecord[]; cached: boolean }>): Finding[] }
  interface ScanResult { findings: Finding[]; offline: boolean; parseError: boolean }
  prepareDocument(uri: string, path: string, text: string, ctx: ScanContext): Promise<PreparedScan | { parseError: true } | undefined>   // undefined: not a matching/enabled file
  scanDocument(uri: string, path: string, text: string, ctx: ScanContext, signal?: AbortSignal): Promise<ScanResult>
  findingKey(f: Pick<Finding, "source" | "ecosystem" | "name" | "current" | "range">): string  // `${source}:${ecosystem}:${name}@${current}:${range.start.line}:${range.start.character}`
  ```
- Behaviour (spec §7.2): classify by path relative to `rootDir`; skip when `!settings.enable`, ecosystem disabled, or lockfile with `!settings.scanLockfiles`. Manifest → parse, `findLockfile`, parse it (lockfile `ParseError` → treat as no lockfile), `resolveVersion`; finding range = `specRange ?? nameRange`; `checkedLowerBound = !fromLockfile`. Lockfile → parse, `findManifestForLockfile`, mark entries whose name is declared in the manifest as `direct`. Per finding: `mergeAliases(records)` → filter `ignores.isIgnored` and `minimumSeverity` → drop if empty; `fix = calculateFix(all records, …)`; `update`:
  - manifest finding with target: edit `specRange` with `rewriteSpec(rawSpec, target).spec` (no `specRange`/`rawSpec` → no edit, but still a finding), `lockCommand` from `module.lockCommand` (cwd = lockfile dir, else manifest dir), `kind: "direct"`, `widened`.
  - lockfile finding, direct, manifest found: same edit applied to the manifest declaration (`uri` of the manifest), `kind: "direct"`.
  - lockfile finding, transitive: `module.transitiveFix(...)`.
  - no target → `update` undefined.
  `parseError: true` when the document itself fails to parse. `offline` from `lookup`. `cached` on each finding from the lookup result.

- [ ] **Step 1: Write failing tests** (stub `osv.lookup` returning records from `test/fixtures/osv`):

```ts
it("manifest resolved via lockfile, update edit preserves caret", async () => {
  const r = await scanDocument("file:///ws/package.json", "/ws/package.json", '{"dependencies":{"lodash":"^4.17.15"}}', ctx({ "/ws/package-lock.json": lockWithLodash("4.17.15") }));
  expect(r.findings[0]).toMatchObject({ name: "lodash", current: "4.17.15", checkedLowerBound: false, fix: { target: "4.17.21" }, update: { kind: "direct", lockCommand: { cwd: "/ws", command: "npm install" } } });
  expect(r.findings[0].update!.edit[0].newText).toBe("^4.17.21");
});
it("no lockfile → lower bound, flagged", async () => {});
it("lockfile transitive finding has via and override plan", async () => {});
it("ignored + below-threshold vulns removed; empty findings dropped", async () => {});
it("parse error reported, no throw", async () => expect((await scanDocument(u, "/ws/package.json", '{"dependencies":', ctx())).parseError).toBe(true));
it("non-matching file → empty result", async () => {});
it("disabled ecosystem → empty result", async () => {});
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): add document scanner producing findings and update plans"`

---

### Task 18: Workspace scanner

**Files:**
- Create: `src/core/workspaceScanner.ts`
- Test: `test/core/workspaceScanner.test.ts`

**Interfaces:**
- Produces: `discoverFiles(rootDir: string, modules: EcosystemModule[], opts?: { exclude?: string[] }): Promise<string[]>` — recursive `fs.promises.readdir`, skipping directories `node_modules`, `target`, `vendor`, `.git`, `dist`, `build`, `.venv`, `venv`, `__pycache__` plus `exclude` globs; returns absolute paths that `classifyFile` matches.
- Produces: `scanFiles(paths: string[], ctx: ScanContext): Promise<{ findings: Finding[]; offline: boolean }>` — `prepareDocument` for each (reading via `ctx.files`), union all queries, **one** `ctx.osv.lookup`, then `finalize` each.

- [ ] **Step 1: Write failing tests** — temp tree with `package.json`, `node_modules/x/package.json`, `svc/requirements.txt`, `README.md`: discovery returns exactly the two manifests; `scanFiles` calls `lookup` once with deduplicated queries (same package in both files counted once).
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): add workspace discovery and batched workspace scan"`

---

### Task 19: Diagnostics and hover rendering

**Files:**
- Create: `src/features/diagnostics.ts`, `src/features/hover.ts`
- Test: `test/features/diagnostics.test.ts`, `test/features/hover.test.ts`

**Interfaces:**
- Produces: `toDiagnostic(f: Finding): Diagnostic` (LSP type from `vscode-languageserver`) — fields per spec §10.2. `message` = `` `${name} ${current} has ${n} known vulnerabilit${n === 1 ? "y" : "ies"} (${ids})` `` where `ids` lists up to 3 preferred IDs then `, +k more`; then `; upgrade to ${target} (fixes all)` or `; no fixed version available`; suffixes in this order when applicable: ` (transitive, via a → b)` or ` (transitive)`, ` (major version upgrade)`, ` (checked lower bound — no lockfile found)`, ` (cached)`. `data` = `{ key, ecosystem, name, current, target, vulnIds, direct, lockCommand }`.
- Produces: `renderHover(f: Finding): string` — markdown per spec Section 3 layout: header `**name current** — n known vulnerabilities`, one row per vuln `- 🔴|🟠|🟡|🔵|⚪ [ID](https://osv.dev/vulnerability/ID) Severity — summary` (critical 🔴, high 🟠, medium 🟡, low 🔵, unknown ⚪), `Suggested: **target** (fixes all n)` or `⚠ No fixed version available`, `⚠ Major version upgrade` / `⚠ Upper bound widened` / `ℹ Checked lower bound — no lockfile found` / `ℹ Cached result (osv.dev unreachable)` lines, and a links line: `[Update to target](command:osv.update?ARGS)` (only when `update` exists; title `Override` for `kind: "override"`), `[View on osv.dev](…)`, `[Ignore ID](command:osv.ignore?ARGS)` where `ARGS = encodeURIComponent(JSON.stringify([args]))`. Summaries escaped with `escapeMarkdown(s)` (backslash-escape ``\`*_{}[]()#+-.!|<>``).
- Produces: `hoverAt(findings: Finding[], pos: Position): Hover | undefined` — first finding whose range contains `pos`.

- [ ] **Step 1: Write failing tests**

```ts
it("diagnostic message for a transitive major upgrade", () => expect(toDiagnostic(finding({ via: ["express", "body-parser"], direct: false, fix: { target: "2.0.0", crossesMajor: true, fixesAll: true } })).message)
  .toBe("qs 1.0.0 has 1 known vulnerability (GHSA-aaaa-bbbb-cccc); upgrade to 2.0.0 (fixes all) (transitive, via express → body-parser) (major version upgrade)"));
it("severity mapping and source", () => { const d = toDiagnostic(finding({ severity: "medium" })); expect(d.severity).toBe(DiagnosticSeverity.Warning); expect(d.source).toBe("osv"); expect(d.codeDescription?.href).toBe("https://osv.dev/vulnerability/GHSA-aaaa-bbbb-cccc"); });
it("truncates ids to 3 + more", () => {});
it("hover escapes summaries and encodes command args", () => { const md = renderHover(finding({ summary: "a *b* [c](javascript:x)" })); expect(md).toContain("a \\*b\\* \\[c\\]\\(javascript:x\\)"); expect(md).toMatch(/command:osv\.update\?%5B%7B/); });
it("no update link without a plan", () => {});
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(features): render diagnostics and hover markdown"`

---

### Task 20: Code actions and finding store

**Files:**
- Create: `src/features/store.ts`, `src/features/codeActions.ts`
- Test: `test/features/codeActions.test.ts`

**Interfaces:**
- Produces: `class FindingStore { set(uri: string, findings: Finding[]): void; get(uri: string): Finding[]; byKey(uri: string, key: string): Finding | undefined; all(): Finding[]; delete(uri: string): void }`
- Produces: `toWorkspaceEdit(plan: UpdatePlan): WorkspaceEdit` (`changes` keyed by `TextEditSpec.uri`).
- Produces: `codeActionsFor(uri: string, findings: Finding[], range: Range): CodeAction[]` — for each finding intersecting `range` with an `update` that has edits: `{ title: "Update <name> to <target>" | "Override <name> to <target>", kind: "quickfix", isPreferred: true, diagnostics: [toDiagnostic(f)], edit: toWorkspaceEdit(plan), command: { title, command: "osv.afterUpdate", arguments: [{ uri, key }] } }`. For `kind: "command-only"` plans: no `edit`, command `osv.afterUpdate` (title `Run "<command>"`) so the client still gets the suggestion.

- [ ] **Step 1: Write failing tests** — titles for direct/override/command-only; edit targets the manifest URI for a lockfile direct finding; findings outside the range excluded.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(features): add code actions and finding store"`

---

### Task 21: LSP server wiring

**Files:**
- Create: `src/server.ts`, `src/serverMain.ts`, `packages/osv-language-server/build.mjs`
- Create: `test/helpers/lspClient.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `startServer(connection: Connection, opts: { cacheDir?: string }): void` in `server.ts`; `serverMain.ts` creates `createConnection(ProposedFeatures.all)` (handles `--stdio`/`--node-ipc`), parses an optional `--cache-dir <dir>` argument, and calls it. Cache dir precedence: `initializationOptions.cacheDir` > `--cache-dir` > `defaultCacheDir()` (which honours `OSV_CACHE_DIR`). `build.mjs` bundles `src/serverMain.ts` → `dist/server.js` and `src/cliMain.ts` → `dist/cli.js` (esbuild, `platform: "node"`, `target: "node20"`, `format: "cjs"`, banner `#!/usr/bin/env node`).
- Initialization: `initializationOptions = { settings?, cacheDir?, clientHandlesIgnore?: boolean }`; capabilities exactly as spec §10.1 with `executeCommandProvider.commands = ["osv.update", "osv.afterUpdate", "osv.scanWorkspace", "osv.getFindings", "osv.clearCache", "osv.ignore"]` (*added* `osv.afterUpdate`: sends the lock-command notification after a client-applied code action). Workspace root = first workspace folder's path (per-document: the containing folder).
- Behaviour:
  - `TextDocuments` sync incremental; `didOpen`/`didSave` scan immediately, `didChange` debounced 750 ms; each scan gets an `AbortController`, aborting the previous one for that URI.
  - On result: `parseError` → keep the store and published diagnostics unchanged; else store + `sendDiagnostics`. `didClose` clears diagnostics unless the URI came from a workspace scan.
  - After `initialized`: register `workspace/didChangeWatchedFiles` for all modules' lockfile globs and `**/osv-scanner.toml`; on change rescan open documents in that directory tree (and reload ignores).
  - `didChangeConfiguration` → `normalizeSettings(params.settings.osv ?? params.settings)` → rescan open docs.
  - `onHover` → `hoverAt`; `onCodeAction` → `codeActionsFor`.
  - `FindingStore` entries record the document version they were computed from. Before applying an edit (`osv.update`), if any target document's current version differs, rescan it first; if the finding with the same `name`/`current` no longer exists, send `window/showMessage` (Info) `"<name> is no longer at <current>; the fix was not applied."` and stop. If `workspace/applyEdit` returns `applied: false`, rescan and show the same message.
  - Commands: `osv.update {uri, key}` → `workspace/applyEdit(toWorkspaceEdit(plan))` then as `osv.afterUpdate`; `osv.afterUpdate {uri, key}` → if `lockCommand` send `osv/suggestLockCommand {cwd, command}`; `osv.scanWorkspace {minimumSeverity?}` → `scanFiles(discoverFiles(root))`, publish diagnostics for every file, return `Finding[]`; `osv.getFindings {uri}` → store; `osv.clearCache` → `cache.clear()` + rescan, return `null`; `osv.ignore {id}` → `clientHandlesIgnore` ? send `osv/addIgnore {id}` : `applyEdit` appending `\n[[IgnoredVulns]]\nid = "<id>"\n` to `<root>/osv-scanner.toml` (create file via `CreateFile` when absent).
  - Notification `osv/status { offline: boolean }` (*added*, for the status bar) after each scan when the value changes.
  - Startup: `cache.housekeep(ttl)`; if `scanWorkspaceOnStartup`, run `osv.scanWorkspace`.
  - All handler errors are caught and logged via `connection.console`; never thrown to the client.
- Produces (test helper): `startTestServer(opts: { osvUrl: string; cacheDir: string; rootDir: string; settings?: Partial<Settings>; clientHandlesIgnore?: boolean }): Promise<{ conn: MessageConnection; diagnostics(uri: string, timeoutMs?: number): Promise<Diagnostic[]>; notifications: { method: string; params: unknown }[]; appliedEdits: WorkspaceEdit[]; stop(): Promise<void> }>` — spawns `node --import tsx src/serverMain.ts --stdio` via `vscode-jsonrpc/node`, answers `workspace/applyEdit` with `{applied: true}` and records it, answers `client/registerCapability`.

- [ ] **Step 1: Write failing tests** (fake OSV from Task 7, temp workspace with `package.json` + `package-lock.json`):

```ts
it("publishes diagnostics on didOpen", async () => { open(pkgJson); const d = await s.diagnostics(uri); expect(d[0]).toMatchObject({ source: "osv", code: "GHSA-29mw-wpgm-hmr9" }); });
it("hover contains the update command link", async () => {});
it("code action edit + afterUpdate sends osv/suggestLockCommand", async () => { /* request codeAction, executeCommand osv.afterUpdate → notifications contains {method: "osv/suggestLockCommand", params: {cwd: root, command: "npm install"}} */ });
it("keeps diagnostics while the file is temporarily invalid", async () => { /* didChange to '{"dependencies":' → after 1s diagnostics unchanged */ });
it("osv.scanWorkspace returns findings for unopened files", async () => {});
it("osv.ignore without client support edits osv-scanner.toml", async () => {});
it("offline: osv/status offline=true and no crash", async () => { /* fake closed */ });
it("osv.update on a stale finding rescans and does not apply", async () => { /* didChange lodash to 4.17.21 without waiting for debounce, executeCommand osv.update with old key → appliedEdits empty; window/showMessage received */ });
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).** Also run `node packages/osv-language-server/build.mjs` and confirm `dist/server.js --stdio` starts (send `initialize` via the helper pointed at the built file once).
- [ ] **Step 5: Commit** — `git commit -m "feat(server): wire LSP server with diagnostics, hover, code actions and commands"`

---

### Task 22: `osv-check` CLI

**Files:**
- Create: `src/cli.ts`, `src/cliMain.ts`
- Test: `test/cli.test.ts`, fixture repos `test/fixtures/repos/{vulnerable,clean}/`

**Interfaces:**
- Produces: `runCheck(argv: string[], io: { stdout: (s: string) => void; stderr: (s: string) => void; cwd: string; env: NodeJS.ProcessEnv }): Promise<number>`; `cliMain.ts` calls it with `process` and `process.exit(code)`.
- Options exactly as spec §13 (`--min-severity`, `--format`, `--strict`, `--no-lockfiles`, `--cache-dir`, `--api-base-url`, `--help`, `--version`), parsed with `node:util` `parseArgs`; unknown option → stderr usage, exit 2.
- Paths given → filtered through `classifyFile` (relative to `cwd`); none → `discoverFiles(cwd)`. Ignores from `findOsvScannerToml(cwd)`. Uses `scanFiles`.
- Text output line: `` `${relPath}:${line + 1}:${character + 1}  ${severity}  ${name} ${current} → ${target ?? "no fix"}  ${firstId}${more}` `` with `more` = `, +k more` when >1 vuln; summary `N vulnerable dependencies in M files` or `No known vulnerabilities`. JSON: `{"findings": Finding[], "offline": boolean}`.
- Offline with no cache: stderr `warning: osv.dev unreachable and no cached data; results incomplete`, exit 0 (or 2 with `--strict`).

- [ ] **Step 1: Write failing tests** — vulnerable repo → exit 1 and the exact text line `package.json:1:30  high  lodash 4.17.15 → 4.17.21  GHSA-…, +2 more` (compute exact columns/severity from the fixture); clean → 0 and `No known vulnerabilities`; `--min-severity critical` → 0; `--format json` parses; unknown flag → 2; offline no cache → 0 with warning, `--strict` → 2; non-matching explicit path ignored.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): add osv-check command"`

---

### Task 23: VS Code client

**Files:**
- Create: `packages/vscode-osv/package.json`, `tsconfig.json`, `build.mjs`, `.vscodeignore`, `src/extension.ts`, `src/statusBar.ts`, `src/commandRunner.ts`, `src/hoverTrust.ts`
- Create: `packages/vscode-osv/test/integration/runTest.ts`, `suite/index.ts`, `suite/smoke.test.ts`, `fixture/package.json`, `fixture/package-lock.json`
- Modify: root `package.json` (`typecheck` includes vscode-osv)

**Interfaces:**
- Consumes: built `osv-language-server/dist/server.js` (copied into `packages/vscode-osv/dist/server.js` by `build.mjs`); notifications `osv/suggestLockCommand`, `osv/addIgnore`, `osv/status`.
- `package.json` contributes: `engines.vscode "^1.90.0"`, `activationEvents` `workspaceContains:` for every Phase-1 manifest/lockfile glob plus `onLanguage:json`/`toml`/`pip-requirements`; `capabilities.untrustedWorkspaces: {supported: "limited", description: "Lock commands are disabled in Restricted Mode."}`; configuration for every setting in spec §12 (types, defaults, enums, descriptions; `ignoredVulnerabilities` `scope: "resource"`); commands `osv.scanWorkspaceUi` ("OSV: Scan workspace"), `osv.clearCacheUi` ("OSV: Clear cache and rescan"), `osv.showLog` ("OSV: Show output log") — UI commands call the server's `osv.scanWorkspace`/`osv.clearCache` via `client.sendRequest(ExecuteCommandRequest.type, …)`.
- `extension.ts`: `LanguageClient("osv", "OSV", { run/debug: { module: dist/server.js, transport: TransportKind.ipc } }, { documentSelector: [{ scheme: "file", pattern: "**/{<all Phase-1 basenames>}" }], synchronize: { configurationSection: "osv" }, initializationOptions: { settings, cacheDir: context.globalStorageUri.fsPath, clientHandlesIgnore: true }, middleware: { provideHover: trustHover } })`. Passes `http.proxy` as `HTTPS_PROXY` in the server's env when set.
- `hoverTrust.ts`: `trustHover` sets `isTrusted = { enabledCommands: ["osv.update", "osv.ignore"] }` on every `MarkdownString` in the hover result.
- `commandRunner.ts`: `handleSuggestLockCommand({cwd, command}, settings, trusted: boolean)` — `never` → nothing; `!vscode.workspace.isTrusted` → nothing; `always` → run; `ask` → `showInformationMessage("Run `<command>` to update the lockfile?", "Run in terminal", "Always", "Never")` (Always/Never update `osv.offerLockCommand` globally, Always also runs). Run = reuse or create terminal named `OSV` with `cwd`, `show()`, `sendText(command)`.
- `osv/addIgnore {id}` → append to `osv.ignoredVulnerabilities` at `ConfigurationTarget.Workspace` (no duplicates).
- `statusBar.ts`: `StatusBarItem` left-aligned; text `$(shield) OSV: N vulnerable` (N = diagnostics with `source === "osv"` in the active editor), `$(shield) OSV: ✓` when 0 for a matching file, `$(shield) OSV: offline` when the last `osv/status` was offline; hidden for non-matching files; click → `workbench.actions.view.problems`. Updates on `onDidChangeDiagnostics` and `onDidChangeActiveTextEditor`.

- [ ] **Step 1: Write the failing integration test** (`@vscode/test-electron`, mocha in `suite/`): start `startFakeOsv` (import from the server package's test helper), set `osv.apiBaseUrl` globally, open `fixture/package.json`; assert within 10 s: a diagnostic with `source "osv"` on the lodash version; `vscode.executeHoverProvider` result contains `command:osv.update`; `vscode.executeCodeActionProvider` returns `Update lodash to 4.17.21`; applying it changes the text to `"^4.17.21"`; status bar text is asserted by exporting the item from `activate()`'s returned API (`{ statusBarText(): string }`).
- [ ] **Step 2: Run to verify failure** — `npm run test:integration -w vscode-osv` (on Linux CI: `xvfb-run -a`) → FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run to verify pass**; run `npx vsce package -o /tmp/vscode-osv.vsix` in `packages/vscode-osv` and confirm the VSIX contains `dist/server.js` and no `node_modules` (`unzip -l`).
- [ ] **Step 5: Commit** — `git commit -m "feat(vscode): add thin VS Code client with status bar and lock-command runner"`

---

### Task 24: Pre-commit hook, agent docs, README

**Files:**
- Create: `.pre-commit-hooks.yaml`, `docs/pre-commit.md`, `docs/agents.md`, `README.md`, `packages/vscode-osv/README.md`, `packages/vscode-osv/CHANGELOG.md`, `packages/osv-language-server/README.md`
- Create: `scripts/test-precommit.sh`
- Modify: root `package.json` (`"files": []` so pre-commit's `npm pack` of the repo root is tiny)

**Interfaces:**
- `.pre-commit-hooks.yaml`: id `osv-check`, `entry: osv-check`, `language: node`, `pass_filenames: true`, `additional_dependencies: ["osv-language-server@<current version>"]`, `files:` regex restricted to Phase-1 basenames: `(^|/)(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock|requirements[^/]*\.txt|requirements/[^/]+\.txt|pyproject\.toml|Pipfile(\.lock)?|poetry\.lock|uv\.lock|pdm\.lock|pylock(\.[^/]+)?\.toml)$`.
- `docs/pre-commit.md`: the four examples from spec §13.1 (pre-commit framework config with `rev` and `args: [--min-severity, high]`; plain `.git/hooks/pre-commit` script that exits 0 when no staged files and otherwise runs `npx --yes osv-check "$@"` on staged paths; Husky `.husky/pre-commit`; lefthook `lefthook.yml` with `glob` + `{staged_files}`; GitHub Actions step `npx --yes osv-check --strict --format json`). Explain exit codes, offline behaviour, `osv-scanner.toml` ignores.
- `docs/agents.md`: generic stdio command `npx osv-language-server --stdio`; `initializationOptions` schema; diagnostic `data` schema; `workspace/executeCommand` table (spec §10.4); Claude Code LSP plugin snippet (verify current plugin manifest format from Claude Code docs at execution time and test it by loading the plugin locally); Neovim `vim.lsp.config`/`lspconfig` snippet with `filetypes`/`root_markers`.
- README: features, GIF placeholders replaced by real recordings before release (Task 25 checklist), **Privacy** section (spec §14.1 wording), settings table, links to docs.
- `scripts/test-precommit.sh`: builds and `npm pack`s the server; creates a temp git repo with a vulnerable `requirements.txt`; writes a `.pre-commit-config.yaml` pointing `repo:` at this checkout (`file://` path, `rev` = `HEAD` sha) with `additional_dependencies: [<path to tarball>]`; runs `pre-commit run --all-files`; asserts exit 1 and output containing `requests`; then fixes the version and asserts exit 0.

- [ ] **Step 1: Write `scripts/test-precommit.sh`** and run it → FAIL (no hook file yet).
- [ ] **Step 2: Write `.pre-commit-hooks.yaml`** and docs; run the script → PASS. Also execute each other snippet from `docs/pre-commit.md` once against the same temp repo (plain hook, Husky, lefthook) and fix any that fail.
- [ ] **Step 3: Commit** — `git commit -m "docs: add pre-commit hook, agent integration docs and README"`

---

### Task 25: CI, release and canary workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `release.yml`, `canary.yml`, `packages/vscode-osv/icon.png`
- Create: `packages/osv-language-server/test/canary/live.test.ts` (excluded from default vitest include; run with `npm run test:canary`)
- Modify: root `package.json` (scripts `test:canary`, `release:prepare`)

**Interfaces:**
- `ci.yml` (push/PR): matrix `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 20 and 22: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, integration tests (`xvfb-run -a` on Linux), and on Ubuntu only `scripts/test-precommit.sh` (with `pip install pre-commit`).
- `release.yml` (tag `v*`): same checks, then `vsce publish` (secret `VSCE_PAT`), `ovsx publish` (secret `OVSX_PAT`), `npm publish -w osv-language-server --provenance` (secret `NPM_TOKEN`); attaches the VSIX to a GitHub release.
- `canary.yml` (nightly cron `0 6 * * *`, `continue-on-error: true`): `npm run test:canary`.
- `live.test.ts`: real `OsvService` against `https://api.osv.dev` with a temp cache: `lodash@4.17.15` (npm) and `requests@2.25.0` (PyPI) each return ≥ 1 record; `calculateFix` gives a target `>=` `4.17.21` / `2.31.0` respectively.
- `release:prepare <version>` script: bumps both packages' versions and the `additional_dependencies` pin in `.pre-commit-hooks.yaml`.

- [ ] **Step 1: Write the canary test**; run `npm run test:canary` locally → PASS (network).
- [ ] **Step 2: Write the workflows**; validate syntax with `npx --yes action-validator .github/workflows/*.yml` (or `actionlint` if installed).
- [ ] **Step 3: Release checklist in `CONTRIBUTING.md`**: choose GitHub org/repo and Marketplace publisher (spec §18), record README GIFs, `npm run release:prepare X.Y.Z`, tag.
- [ ] **Step 4: Full verification** — `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run test:integration -w vscode-osv` all pass.
- [ ] **Step 5: Commit** — `git commit -m "ci: add CI, release and nightly canary workflows"`
