# OSV Extension — Phase 3 (Ruby, PHP, GitHub Actions, Dart, Elixir, Swift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the rubygems, packagist, githubActions, pub, hex and swift ecosystem modules and release the complete 12-ecosystem extension.

**Architecture:** Same module contract as Phases 1–2 (`src/ecosystems/types.ts`). Task 1 adds one optional hook — client-side version matching — because osv.dev does not match versions server-side for GitHub Actions. Code-based manifests (`Gemfile`, `*.gemspec`, `mix.exs`, `Package.swift`) use documented regex heuristics; unmatched forms are skipped.

**Tech Stack:** As Phases 1–2; no new runtime dependencies (`yaml` and `jsonc-parser` already present).

**Spec:** `docs/superpowers/specs/2026-10-18-osv-vscode-extension-design.md`
**Builds on:** Phase 1 and Phase 2 plans in `docs/superpowers/plans/` (all their interfaces are available, including `resolveExternal`, `nameKey`, `manifestsForLockfile`, `specLocation`, `TransitiveCtx.current`, and `scripts/sync-patterns.mjs`).

## Global Constraints

- All Phase 1 and Phase 2 Global Constraints apply.
- OSV ecosystem names exactly: `RubyGems`, `Packagist`, `GitHub Actions`, `Pub`, `Hex`, `SwiftURL`.
- **GitHub Actions:** `querybatch` with a version returns no results (verified: `tj-actions/changed-files` @ `45.0.0` → 0; without version → 2). Query package-only and filter with `isAffected` locally. OSV versions are loose (e.g. `fixed: "41"`), so comparison coerces (`41` → `41.0.0`, `v4.1` → `4.1.0`).
- **SwiftURL** package names are `github.com/<owner>/<repo>` — no scheme, no `.git` (verified: the `https://…git` form returns 0).
- Pessimistic operators (`~>` in RubyGems and Hex) keep their upper-bound semantics on rewrite: when the target has more significant non-zero segments than the constraint's precision, emit a compound constraint (RubyGems `'~> 1.16', '>= 1.16.6'`; Hex `"~> 1.16 and >= 1.16.6"`) instead of increasing precision.
- A rewritten spec must never admit versions below the target.

## Review Focus

1. **Platform-specific gems in Gemfile.lock** (`nokogiri (1.13.0-x86_64-linux)`) — version is `1.13.0`, one finding even with several platform entries. Test in Task 3.
2. **SHA-pinned actions with a version comment** (`uses: actions/checkout@8f4b7f8… # v4.1.1`) — skipped (spec: SHAs skipped), no false positive. Test in Task 6.
3. **Composer `dev-main` / `*` / `php` / `ext-*` requirements** — not queried, no crash. Test in Task 5.
4. **Flutter SDK dependencies in pubspec.yaml** (`flutter: { sdk: flutter }`) — skipped. Test in Task 7.
5. **`Package.swift` with SSH URLs** (`git@github.com:owner/repo.git`) — normalized to `github.com/owner/repo` so the query matches. Test in Task 9.

---

## File Structure

```
packages/osv-language-server/src/
  versioning/rubygems.ts  composer.ts  semverLoose.ts
  ecosystems/
    rubygems/index.ts  requirement.ts  gemfile.ts  gemspec.ts  gemfileLock.ts
    packagist/index.ts  constraint.ts  composerJson.ts  composerLock.ts
    githubActions/index.ts  workflow.ts
    pub/index.ts  pubspec.ts  pubspecLock.ts
    hex/index.ts  requirement.ts  mixExs.ts  mixLock.ts
    swift/index.ts  url.ts  packageSwift.ts  packageResolved.ts
```

---

### Task 1: Client-side version matching

**Files:**
- Modify: `src/ecosystems/types.ts`, `src/core/types.ts` (doc comment), `src/core/osvClient.ts`, `src/core/scanner.ts`
- Create: `src/versioning/semverLoose.ts`
- Test: `test/core/clientSideMatching.test.ts`, `test/versioning/semverLoose.test.ts`

**Interfaces:**
- `EcosystemModule` gains `clientSideMatching?: boolean`.
- `LockCtx` gains optional `manifestText?: string`; the scanner passes the manifest text it already read (used by Pub in Task 7).
- `PackageQuery.version === ""` means "package-only": `OsvClient.queryBatch` omits `version` from that query; the cache key is `ecosystem|name|` (unchanged `queryKey`).
- Scanner: for a module with `clientSideMatching`, emit one package-only query per distinct name; at finalize, keep for each dependency only the records where `isAffected(records, …, current)` is true (then proceed as before).
- Produces: `semverLooseComparator: Comparator` — `semver.coerce` with `{loose: true}` on both sides (`"41"` → `41.0.0`, `"v4.1"` → `4.1.0`); `isValid` = coerce succeeds; `major` from coerced.

- [ ] **Step 1: Write failing tests**

```ts
it("package-only query omits version", async () => { /* MockAgent asserts body.queries[0] has no "version" key */ });
it("filters records locally", async () => { /* fake module clientSideMatching; records GHSA-mcph-m25j-8j63 (fixed 41) and GHSA-mrrh-fwg8-r2c3 (fixed 46.0.1); current "45" → only GHSA-mrrh remains; target "46.0.1" */ });
it.each([["41", "45.0.0", -1], ["v4.1", "4.1.0", 0], ["46.0.1", "46", 1]])("loose compare %s %s", (a, b, r) => expect(Math.sign(semverLooseComparator.compare(a, b))).toBe(r));
```
Download `GHSA-mcph-m25j-8j63` and `GHSA-mrrh-fwg8-r2c3` into `test/fixtures/osv/`.

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).** Run the full suite (`npm test`) to confirm no regressions.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): support client-side version matching for package-only OSV queries"`

---

### Task 2: RubyGems versions and requirements

**Files:**
- Create: `src/versioning/rubygems.ts`, `src/ecosystems/rubygems/requirement.ts`
- Test: `test/versioning/rubygems.test.ts`, `test/ecosystems/rubygems/requirement.test.ts`

**Interfaces:**
- Produces: `rubygemsComparator: Comparator` — `Gem::Version` semantics: split on `.` and at digit↔letter boundaries; any segment containing a letter makes the version a prerelease (`1.0.a` < `1.0`); numeric segments compare numerically, string segments lexically, numeric > string; trailing zeros ignored (`1.0` == `1`); `-` treated as `.pre.`. `major` = first segment.
- Produces: `gemLowerBound(reqs: string[]): string | undefined` — highest of `= X`, `>= X`, `~> X` (`X` bare means `= X`); only `<`, `<=`, `!=`, `>` → `undefined`.
- Produces: `rewriteGemRequirements(reqs: string[], target: string): { reqs: string[]; widened: boolean }` — `= X`/bare → target (same style); `>= X` → `>= target`; `~> X` with n segments: if the target truncated to n segments padded with zeros equals the target → `~> <target truncated to n segments>` (e.g. `~> 1.4` + `1.6.0` → `~> 1.6`); otherwise keep `~> <target truncated to n segments>` and add `>= target` (e.g. `~> 1.4` + `1.6.3` → `['~> 1.6', '>= 1.6.3']`); `~> X` whose upper bound excludes the target (`~> 1.4.2` + `1.6.0`) → move to the target's line (`~> 1.6.0`), `widened: true`; `<`/`<=` clauses the target violates are dropped (`widened`); after rewriting, duplicate `>=` clauses are merged into the highest one (`['~> 2.2', '>= 2.2.3']` + `2.2.20` → `['~> 2.2', '>= 2.2.20']`). `TextEdit` covers all requirement string literals of the declaration (see Task 3).

- [ ] **Step 1: Write failing tests** — comparator table: `2.2.8.1 > 2.2.8`, `1.0.a < 1.0`, `1.0 == 1.0.0`, `2.2.20 > 2.2.18`; lower bounds `["~> 1.2", ">= 1.2.3"]` → `1.2.3`; rewrites exactly as the examples above.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(rubygems): add Gem::Version comparator and requirement handling"`

---

### Task 3: RubyGems parsers and module

**Files:**
- Create: `src/ecosystems/rubygems/gemfile.ts`, `gemspec.ts`, `gemfileLock.ts`, `index.ts`; Modify: `src/ecosystems/index.ts`
- Test: one test per parser + `module.test.ts`; fixture `Gemfile.lock` generated with `bundle lock` from a fixture Gemfile depending on `rack 2.2.3` and `nokogiri 1.13.0`

**Interfaces:**
- Produces: `parseGemfile(text: string): DeclaredDep[]` — lines `gem "name"[, "req"…][, opts]` (single or double quotes, optional parens); requirement literals are the consecutive string args after the name; `specRange` spans from the first requirement literal's opening quote to the last's closing quote and `rawSpec` is that raw text; options `git:`, `github:` → `git`, `path:` → `path`; `group :a, :b do … end` blocks and `group:` option set `group`; comments and `source`/`ruby` lines skipped; no requirement → `unresolved`.
- Produces: `parseGemspec(text: string): DeclaredDep[]` — `<x>.add_dependency`, `add_runtime_dependency` (group `runtime`), `add_development_dependency` (group `development`), same argument handling.
- Produces: `parseGemfileLock(text: string): ResolvedDep[]` — `GEM`/`specs:` section: 4-space lines `name (version[-platform])` → entries (platform suffix stripped; same `name@version` deduplicated); 6-space lines → edges; `GIT`/`PATH` sections skipped; `DEPENDENCIES` section names → `direct`; range = version text (without platform).
- Produces: `rubygemsModule: EcosystemModule` — `id "rubygems"`, `osvEcosystem "RubyGems"`, `manifests ["Gemfile", "gems.rb", "*.gemspec"]`, `lockfiles ["Gemfile.lock", "gems.locked"]`, `lockfilesForManifest`: `Gemfile` → `["Gemfile.lock"]`, `gems.rb` → `["gems.locked"]`, gemspec → `["Gemfile.lock"]`; `manifestsForLockfile`: `Gemfile.lock` → `["Gemfile"]`, `gems.locked` → `["gems.rb"]`; `versioning rubygemsComparator`; `rewriteSpec(raw, target)` = parse the quoted literals out of `raw`, `rewriteGemRequirements`, re-serialise with the original quote style and `, ` separators; `lockCommand` → `bundle install`; `transitiveFix` → `{ kind: "command-only", edit: [], lockCommand: "bundle update --conservative <name>" }`.

- [ ] **Step 1: Write failing tests**

```ts
it("Gemfile forms", () => expect(rows(parseGemfile(read("Gemfile")))).toEqual([["rack", "default", "2.2.3", "registry"], ["rails", "default", "7.0.0", "registry"], ["rspec", "test", "3.0", "registry"], ["mygem", "default", undefined, "git"]]));
it("platform gems collapse", () => expect(parseGemfileLock(read("Gemfile.lock")).filter(d => d.name === "nokogiri")).toHaveLength(1));
it("rack 2.2.3 with three real records → 2.2.20", async () => { /* download GHSA-22f2-v57c-j9cx, GHSA-625h-95r8-8xpm, GHSA-6xw4-3v39-52mm; scanDocument on Gemfile → target "2.2.20"; edit text "'~> 2.2', '>= 2.2.20'" for a "'~> 2.2', '>= 2.2.3'" declaration */ });
it("transitive command", () => expect(rubygemsModule.transitiveFix({ name: "racc", current: "1.6.0", target: "1.6.2", lockfilePath: "/p/Gemfile.lock" })?.lockCommand?.command).toBe("bundle update --conservative racc"));
```
(Group `default` for top-level gems. Write the fixture Gemfile to match these rows.)

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(rubygems): parse Gemfile, gemspec and Gemfile.lock"`

---

### Task 4: Composer versions and constraints

**Files:**
- Create: `src/versioning/composer.ts`, `src/ecosystems/packagist/constraint.ts`
- Test: `test/versioning/composer.test.ts`, `test/ecosystems/packagist/constraint.test.ts`

**Interfaces:**
- Produces: `composerComparator: Comparator` — normalize: strip `v`, pad to 4 numeric parts; stability suffixes ordered `dev < alpha|a < beta|b < RC|rc < (stable) < patch|pl|p`, each with optional number; `major` first part.
- Produces: `composerLowerBound(constraint: string): string | undefined` — OR groups (`||` or `|`) → lowest lower bound across groups; AND (space or `,`) → highest; `^X`, `~X`, `X`, `X.*` (→ `X.0`), `>=X`, `X - Y` → `X`; `*`, `dev-*`, `<…` only → `undefined`; stability flags `@dev`/`@stable` stripped.
- Produces: `rewriteComposerConstraint(raw: string, target: string): RewriteResult` — single comparator: keep operator (`^`, `~`, `>=`, bare); keep precision only when lossless (`^7.4` + `7.15.0` → `^7.15`; `^7.4` + `7.4.5` → `^7.4.5`); OR groups: rewrite the group containing the current major, drop groups entirely below the target (`widened: true` if any dropped); hyphen ranges `X - Y` → `target - Y` (dropping `Y` if violated, `widened`).

- [ ] **Step 1: Write failing tests** — comparator: `7.4.5 > 7.4.4`, `1.0.0-RC1 < 1.0.0`, `v2.0 == 2.0.0.0`; lower bounds: `^7.0 || ^8.0` → `7.0`, `>=7.4 <8` → `7.4`, `dev-main` → `undefined`; rewrites as listed plus `^6.5 || ^7.0` + `7.4.5` → `^7.4.5`, `widened: true`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(packagist): add Composer comparator and constraint handling"`

---

### Task 5: Packagist parsers and module

**Files:**
- Create: `src/ecosystems/packagist/composerJson.ts`, `composerLock.ts`, `index.ts`; Modify: `src/ecosystems/index.ts`
- Test: parser tests + `module.test.ts`; fixture `composer.lock` generated with `composer update --no-install` from a fixture requiring `guzzlehttp/guzzle 7.4.4`

**Interfaces:**
- Produces: `parseComposerJson(text: string): DeclaredDep[]` — `require` and `require-dev`; skip platform packages `php`, `php-*`, `hhvm`, `ext-*`, `lib-*`, `composer`, `composer-plugin-api`, `composer-runtime-api`; `dev-*` or `*-dev` → `git`; names lowercased (`normalizeName`); ranges via `jsonc-parser` as in npm.
- Produces: `parseComposerLock(text: string): ResolvedDep[]` — `packages` + `packages-dev`; version `v` prefix kept in `version` for range accuracy but compared via `composerComparator`; `dev-*` versions skipped; edges from `require`; `direct: false` (scanner marks via manifest); range = `version` value content.
- Produces: `packagistModule: EcosystemModule` — `id "packagist"`, `osvEcosystem "Packagist"`, `manifests ["composer.json"]`, `lockfiles ["composer.lock"]`, `lockfilesForManifest → ["composer.lock"]`, `manifestForLockfile → "composer.json"`, `normalizeName` lowercase, `versioning composerComparator`, `rewriteSpec rewriteComposerConstraint`, `lockCommand` → `composer update <name>`, `transitiveFix` → `{ kind: "command-only", edit: [], lockCommand: "composer update <name>" }`.

- [ ] **Step 1: Write failing tests** — platform/dev requirements skipped (`php`, `ext-json`, `dev-main` absent from queries); `guzzlehttp/guzzle` locked `7.4.4`; with downloaded `GHSA-25mq-v84q-4j7r` + `GHSA-f283-ghqc-fg79`, scanning `composer.json` (`"^7.4"`) yields target `7.15.1` and edit `^7.15.1`; `lockCommand` string.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(packagist): parse composer.json and composer.lock"`

---

### Task 6: GitHub Actions module

**Files:**
- Create: `src/ecosystems/githubActions/workflow.ts`, `index.ts`; Modify: `src/ecosystems/index.ts`
- Test: `test/ecosystems/githubActions/workflow.test.ts`, `module.test.ts`

**Interfaces:**
- Produces: `parseWorkflow(text: string): DeclaredDep[]` — YAML via `yaml` `parseDocument` (ranges from scalar nodes); collects `jobs.<id>.steps[].uses`, `jobs.<id>.uses` (reusable workflows), and `runs.steps[].uses` (composite `action.yml`). For `owner/repo[/path]@ref`: name `owner/repo` (path dropped); `ref` matching `^v?\d+(\.\d+){0,2}$` → `registry`, `rawSpec` = ref, `specRange` = the ref's characters inside the scalar, `lowerBound` = ref without `v`; 40-hex SHAs, other refs → skipped (not returned); `./local` and `docker://` → skipped. Group = job id (or `"composite"`). YAML syntax errors → `ParseError`.
- Produces: `githubActionsModule: EcosystemModule` — `id "githubActions"`, `osvEcosystem "GitHub Actions"`, `manifests [".github/workflows/*.yml", ".github/workflows/*.yaml", "action.yml", "action.yaml"]`, `lockfiles []`, `manifestIsExact: true`, `clientSideMatching: true`, `normalizeName` identity, `nameKey` lowercase, `versioning semverLooseComparator`, `rewriteSpec(raw, target)` → keep `v` prefix if present; keep precision only when lossless (`v45` + `46.0.0` → `v46`; `v45` + `46.0.1` → `v46.0.1`), `lockCommand` → `undefined`, `transitiveFix` → `undefined`.

- [ ] **Step 1: Write failing tests**

```ts
it("collects uses with ref ranges; skips SHAs, local, docker, branches", () => {
  const text = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: tj-actions/changed-files@v45\n      - uses: actions/setup-node@8f4b7f84864484a7bf31766abe9204da3cbe65b3 # v4.1.1\n      - uses: ./local\n      - uses: docker://alpine:3\n      - uses: org/repo/sub/path@main\n  r:\n    uses: org/shared/.github/workflows/ci.yml@v1.2\n";
  expect(parseWorkflow(text).map(d => [d.name, d.rawSpec, d.group])).toEqual([["actions/checkout", "v4", "b"], ["tj-actions/changed-files", "v45", "b"], ["org/shared", "v1.2", "r"]]);
  expect(textAt(text, parseWorkflow(text)[1].specRange!)).toBe("v45");
});
it("tj-actions/changed-files@v45 → v46.0.1 via package-only query", async () => { /* scanDocument with fake OSV serving both records for the package-only key → one finding, target "46.0.1", edit "v46.0.1" */ });
it("classifies nested workflow paths", () => expect(classifyFile(".github/workflows/ci.yml")?.module.id).toBe("githubActions"));
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(github-actions): highlight vulnerable action versions in workflows"`

---

### Task 7: Pub (Dart/Flutter) module

**Files:**
- Create: `src/ecosystems/pub/pubspec.ts`, `pubspecLock.ts`, `index.ts`; Modify: `src/ecosystems/index.ts`
- Test: parser tests + `module.test.ts`; fixture `pubspec.lock` generated with `dart pub get` from a fixture depending on `http: 0.12.0`

**Interfaces:**
- Produces: `parsePubspec(text: string): DeclaredDep[]` — `dependencies`, `dev_dependencies`, `dependency_overrides` (groups by key); value string spec, `null`/missing (→ `unresolved`), or map with `version` (+ `hosted`); `git`/`path` maps → kinds; `sdk:` maps → skipped. Lower bound: `^X`/`X`/`>=X` → `X` (via `semver.minVersion` with `^`); `any` → `undefined`.
- Produces: `parsePubspecLock(text: string): ResolvedDep[]` — `packages.<name>.{dependency, source, version}`; `source` `sdk`/`path`/`git` skipped; `dependency` starting with `direct` → `direct: true`; range = version scalar content (quotes excluded).
- Produces: `pubModule: EcosystemModule` — `id "pub"`, `osvEcosystem "Pub"`, `manifests ["pubspec.yaml"]`, `lockfiles ["pubspec.lock"]`, `lockfilesForManifest → ["pubspec.lock"]`, `manifestForLockfile → "pubspec.yaml"`, `versioning semverComparator`, `rewriteSpec` = Phase 1 `rewriteNpmSpec` (Pub caret/range syntax is a subset), `lockCommand` → `flutter pub get` when `LockCtx.manifestText` (Task 1) declares an `sdk: flutter` dependency, else `dart pub get`; `transitiveFix` → `undefined`.

- [ ] **Step 1: Write failing tests** — Flutter SDK dep skipped; `http: 0.12.0` with downloaded `GHSA-4rgh-jx4f-qfcq` → target `0.13.3`, edit `0.13.3`; lockfile direct/transitive marking; Flutter project → `flutter pub get`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(pub): parse pubspec.yaml and pubspec.lock"`

---

### Task 8: Hex (Elixir) module

**Files:**
- Create: `src/ecosystems/hex/requirement.ts`, `mixExs.ts`, `mixLock.ts`, `index.ts`; Modify: `src/ecosystems/index.ts`
- Test: one per file; fixture `mix.lock` generated with `mix deps.get` from a fixture depending on `{:plug, "~> 1.3.0"}`

**Interfaces:**
- Produces: `hexLowerBound(req: string): string | undefined` — Elixir `Version` requirements: `or` groups → lowest; `and` → highest; `~> X.Y` / `~> X.Y.Z` / `>= X` / `== X` / bare `X` → `X` (padded to 3 parts); `<`/`!=` only → `undefined`.
- Produces: `rewriteHexRequirement(raw: string, target: string): RewriteResult` — same rules as RubyGems `~>` (Global Constraints): `~> 1.3.0` + `1.16.6` → `~> 1.16.6` (`widened: true`, upper bound moved); `~> 1.3` + `1.16.6` → `~> 1.16 and >= 1.16.6`; `~> 1.3` + `1.16.0` → `~> 1.16`; `>= X` → `>= target`; `== X` → `== target`.
- Produces: `parseMixExs(text: string): DeclaredDep[]` — inside the `defp deps` / `def deps` function body: tuples `{:name, "req"}`, `{:name, "req", opts}`, `{:name, opts}`; opts `git:`/`github:` → `git`, `path:` → `path`, `only:` → `group` (`only: :test` → `"test"`, list → joined `,`), else `"deps"`; `specRange` = the requirement string content; comments (`#`) ignored.
- Produces: `parseMixLock(text: string): ResolvedDep[]` — lines `"name": {:hex, :pkg, "version", …, [deps…], "hexpm", …}`; `name` = `pkg` atom; `:git`/`:path` entries skipped; edges from the deps list `{:dep, …}`; `direct: false` (scanner marks via manifest); range = version string content.
- Produces: `hexModule: EcosystemModule` — `id "hex"`, `osvEcosystem "Hex"`, `manifests ["mix.exs"]`, `lockfiles ["mix.lock"]`, `lockfilesForManifest → ["mix.lock"]`, `manifestForLockfile → "mix.exs"`, `versioning semverComparator`, `rewriteSpec rewriteHexRequirement`, `lockCommand` → `mix deps.update <name>`, `transitiveFix` → `undefined`.

- [ ] **Step 1: Write failing tests** — mix.exs tuple forms (string, string+opts, git, path, only list); requirement lower bounds and rewrites exactly as listed; `plug 1.3.0` with downloaded `EEF-CVE-2026-56813` → target `1.16.6` (verify against the record's events before asserting).
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(hex): parse mix.exs and mix.lock"`

---

### Task 9: Swift module

**Files:**
- Create: `src/ecosystems/swift/url.ts`, `packageSwift.ts`, `packageResolved.ts`, `index.ts`; Modify: `src/ecosystems/index.ts`
- Test: one per file; fixture `Package.resolved` v1, v2 and v3 samples (hand-written from Swift's documented formats) and one generated with `swift package resolve` if the toolchain is available

**Interfaces:**
- Produces: `normalizeSwiftUrl(url: string): string | undefined` — strip scheme, credentials, trailing `/` and `.git`; `git@host:owner/repo` → `host/owner/repo`; lowercase host; non-URL → `undefined`. (`https://github.com/apple/swift-nio.git` → `github.com/apple/swift-nio`.)
- Produces: `parsePackageSwift(text: string): DeclaredDep[]` — `.package(` calls (multi-line aware, comments stripped): `url: "…"` plus one of `from: "X"`, `exact: "X"`, `.exact("X")`, `.upToNextMajor(from: "X")`, `.upToNextMinor(from: "X")`, `"X"..<"Y"`, `"X"..."Y"`; `branch:`/`revision:` → `git`; `path:` → `path`; `id:` (registry) → skipped. `name` = `normalizeSwiftUrl(url)`; `lowerBound` = `X`. For range forms (`"X"..<"Y"`, `"X"..."Y"`) `rawSpec` is the raw text from X's opening quote to Y's closing quote and `specRange` covers it; for all other forms `rawSpec` = `X` and `specRange` = the `X` string content.
- Produces: `parsePackageResolved(text: string): ResolvedDep[]` — v1 `object.pins[].{repositoryURL, state.version}`, v2/v3 `pins[].{location, state.version}`; pins without `version` skipped; name normalized; range = version string content; `direct: false` (scanner marks via manifest).
- Produces: `swiftModule: EcosystemModule` — `id "swift"`, `osvEcosystem "SwiftURL"`, `manifests ["Package.swift"]`, `lockfiles ["Package.resolved"]`, `lockfilesForManifest → ["Package.resolved"]`, `manifestForLockfile → "Package.swift"`, `normalizeName: (n) => normalizeSwiftUrl(n) ?? n`, `nameKey` lowercase, `versioning semverComparator`, `rewriteSpec(raw, target)`: a bare `X` → `{ spec: target, widened: false }` (the surrounding `from:`/`exact:`/`.upToNextMajor(from:)` form is untouched because only `X` is replaced); a range `"X"..<"Y"` / `"X"..."Y"` → replace X with the target, and if the target is outside the range (≥ Y for `..<`, > Y for `...`) also replace Y with `"<target major + 1>.0.0"` (keeping the operator) and set `widened: true`; `lockCommand` → `swift package update`, `transitiveFix` → `undefined`.

- [ ] **Step 1: Write failing tests**

```ts
it.each([["https://github.com/apple/swift-nio.git", "github.com/apple/swift-nio"], ["git@github.com:apple/swift-nio.git", "github.com/apple/swift-nio"], ["https://GitHub.com/Apple/swift-nio/", "github.com/Apple/swift-nio"]])("normalize %s", (u, n) => expect(normalizeSwiftUrl(u)).toBe(n));
it("Package.swift forms", () => expect(rows(parsePackageSwift(read("Package.swift")))).toEqual([["github.com/apple/swift-nio", "2.29.0", "registry"], ["github.com/vapor/vapor", "4.0.0", "registry"], ["github.com/a/b", undefined, "git"]]));
it("Package.resolved v1/v2/v3", () => { /* each yields swift-nio 2.29.0 */ });
it.each([['2.29.0', '2.100.0', '2.100.0', false], ['"2.0.0"..<"2.50.0"', '2.100.0', '"2.100.0"..<"3.0.0"', true], ['"2.0.0"..<"3.0.0"', '2.100.0', '"2.100.0"..<"3.0.0"', false]])("rewrite %s", (raw, t, spec, w) => expect(swiftModule.rewriteSpec(raw, t)).toEqual({ spec, widened: w }));
it("swift-nio 2.29.0 → 2.100.0", async () => { /* download GHSA-cq87-8r7h-962v, GHSA-r3rc-9hpw-54v9, GHSA-rj37-6j9x-74q6; target "2.100.0" */ });
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(swift): parse Package.swift and Package.resolved"`

---

### Task 10: End-to-end coverage, docs, 1.0 release

**Files:**
- Create: `test/fixtures/repos/{rubygems,packagist,actions,pub,hex,swift}/`
- Modify: `test/cli.test.ts`, `test/server.test.ts`, `test/canary/live.test.ts`, `README.md`, `docs/agents.md`, `docs/pre-commit.md`, `packages/vscode-osv/CHANGELOG.md`, `packages/vscode-osv/package.json` (`activationEvents` regenerated; add `onLanguage:yaml`, `onLanguage:ruby`, `onLanguage:elixir`, `onLanguage:swift`, `onLanguage:php` only if `sync-patterns` doesn't already cover activation)
- Modify (generated): `npm run sync-patterns`

**Interfaces:**
- CLI test: each fixture repo exits 1 with the expected `name current → target` line (fake OSV with the records downloaded in Tasks 1, 3, 5, 7, 8, 9).
- Server test: opening a workflow file produces a diagnostic on `v45`; opening `Gemfile` produces a compound-requirement code action.
- Canary adds `rack 2.2.3`, `guzzlehttp/guzzle 7.4.4`, `http 0.12.0` (Pub), `plug 1.3.0`, `github.com/apple/swift-nio 2.29.0`, and package-only `tj-actions/changed-files` (asserting ≥ 1 record, and that a versioned query still returns 0 — if it starts returning results, the canary flags that `clientSideMatching` may be removable).
- Docs: README supported-files table complete (all 12 ecosystems, spec §6.2), known limitations section (heuristic parsing for `Gemfile`, `*.gemspec`, `mix.exs`, `Package.swift`, `build.gradle(.kts)`; lower-bound fallback; NuGet casing without lockfile); CHANGELOG `1.0.0`.

- [ ] **Step 1: Write the failing CLI/server tests** → run → FAIL for the new fixtures.
- [ ] **Step 2: Fix integration gaps** until they pass; `npm run sync-patterns && npm run check-patterns`.
- [ ] **Step 3: Full verification** — `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run test:integration -w vscode-osv && scripts/test-precommit.sh` all pass; `npm run test:canary` passes.
- [ ] **Step 4: Commit** — `git commit -m "feat: release Phase 3 ecosystems; 1.0.0"`
