# OSV Extension — Phase 2 (Rust, Java/Kotlin, Go, C#) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the cargo, maven (Maven + Gradle), go and nuget ecosystem modules to the Phase 1 engine, including versions defined in other files (workspace inheritance, properties, version catalogs, central package management), and release.

**Architecture:** Each ecosystem is a self-contained module implementing Phase 1's `EcosystemModule` (`src/ecosystems/types.ts`). Task 1 extends that contract with four optional hooks the new ecosystems need; the scanner honours them, existing npm/PyPI modules are unaffected. Task 2 makes the file-pattern lists single-source so the VS Code client and pre-commit hook pick up new ecosystems automatically.

**Tech Stack:** As Phase 1, plus no new runtime dependencies (XML via a small in-repo tokenizer; Maven and NuGet comparators in-repo).

**Spec:** `docs/superpowers/specs/2026-10-18-osv-vscode-extension-design.md`
**Builds on:** `docs/superpowers/plans/2026-10-18-osv-phase1-core-npm-pypi.md` (all of its interfaces are available)

## Global Constraints

- All Phase 1 Global Constraints apply.
- OSV ecosystem names exactly: `crates.io`, `Maven`, `Go`, `NuGet`.
- **NuGet names are case-sensitive at osv.dev** (`newtonsoft.json` returns nothing; `Newtonsoft.Json` matches). Query with the lockfile's casing when a lockfile entry exists, otherwise the declared casing. Matching between manifest, lockfile and OSV `affected[].package.name` is case-insensitive.
- Go: osv.dev accepts versions with or without the `v` prefix; edits keep the `v`.
- Maven package name is `groupId:artifactId`.
- A rewritten spec must never admit versions below the target (precision is preserved only when it loses nothing).
- Unmatched declaration forms in code-based files (`build.gradle(.kts)`) are skipped silently.

## Review Focus

1. **NuGet name casing differs between csproj and registry** (`newtonsoft.json` in csproj) — with a lockfile the query uses the lockfile casing and the finding appears. Test in Task 12.
2. **Cargo renamed dependency** (`foo = { package = "real-name", version = "1" }`) — the OSV query must use `real-name`. Test in Task 4.
3. **Maven version from an undefined property** (`${missing.version}`) — no finding, no crash. Test in Task 7.
4. **`go.mod` with a `replace` to a local path** — the replaced module is skipped, not reported at the original version. Test in Task 10.
5. **Multiple target frameworks in `packages.lock.json`** — one finding per distinct package version, not one per framework. Test in Task 12.

---

## File Structure

```
packages/osv-language-server/src/
  core/xml.ts                         minimal offset-preserving XML tokenizer
  versioning/maven.ts  nuget.ts       (cargo + go reuse semverComparator variants in their modules)
  ecosystems/
    cargo/index.ts  manifest.ts  req.ts  lock.ts
    maven/index.ts  pom.ts  range.ts  gradle.ts  catalog.ts  gradleLock.ts
    go/index.ts  gomod.ts
    nuget/index.ts  range.ts  project.ts  packagesConfig.ts  lock.ts
scripts/sync-patterns.mjs             generates pattern lists into client package.json and .pre-commit-hooks.yaml
```

---

### Task 1: Contract extensions

**Files:**
- Modify: `src/core/types.ts`, `src/ecosystems/types.ts`, `src/core/lockfileResolver.ts`, `src/core/scanner.ts`, `src/core/fixCalculator.ts` (call sites only), `src/server.ts` (watchers)
- Test: `test/core/scannerExtensions.test.ts`, additions to `test/core/lockfileResolver.test.ts`

**Interfaces:**
- `DeclaredDep` gains `specLocation?: { path: string; range: TextRange; rawSpec: string }` — where the version text actually lives when it is not inline (a property in the same file, or another file). The finding still sits at the declaration (`specRange ?? nameRange`); the update edit targets `specLocation`.
- `EcosystemModule` gains optional members:
  - `nameKey?(name: string): string` — case/format-insensitive key for matching (default: `normalizeName`). Used by `resolveVersion`, lockfile direct-marking in the scanner, and as the `normalizeName` argument to `calculateFix`/`isAffected`.
  - `manifestIsExact?: boolean` — manifest versions are resolved versions (Go): no lockfile lookup, `checkedLowerBound = false`.
  - `resolveExternal?(deps: DeclaredDep[], ctx: { manifestPath: string; rootDir: string; files: FileSource }): Promise<DeclaredDep[]>` — fills `rawSpec`/`lowerBound`/`kind`/`specLocation` from other files; called by the scanner after `parseManifest`.
  - `relatedFiles?: string[]` — globs of files whose change should rescan open documents in the same tree (registered as watchers alongside lockfiles).
  - `manifestsForLockfile?(lockfileBasename: string): string[]` — candidate manifest basenames in preference order; preferred over `manifestForLockfile` when present. A candidate containing a single `*` (e.g. `*.csproj`) is expanded by `findManifestForLockfile` via `readdir` of the lockfile's directory (first match in sorted order). Add `list(dir: string): Promise<string[]>` to `FileSource` (`nodeFileSource` → `readdir`, `[]` on error; `overlayFileSource` delegates).
- `TransitiveCtx` gains `current: string`; the scanner passes `finding.current`.
- `resolveVersion` now returns `{ version: string; fromLockfile: boolean; name: string }` — `name` is the lockfile entry's name when matched (NuGet casing), else `dep.name`. The scanner queries OSV with this `name`.
- Scanner: when building a manifest update plan and `dep.specLocation` is set, edit `pathToFileURL(specLocation.path)` at `specLocation.range` with `rewriteSpec(specLocation.rawSpec, target)`.

- [ ] **Step 1: Write failing tests** with an in-test fake module:

```ts
it("edits specLocation instead of the declaration", async () => { /* fake resolveExternal sets specLocation in /ws/versions.txt → finding.range is in the scanned doc, update.edit[0].uri === "file:///ws/versions.txt" */ });
it("manifestIsExact skips lockfile lookup and checkedLowerBound=false", async () => {});
it("nameKey matches case-insensitively and queries with the lockfile casing", async () => { /* manifest "newtonsoft.json", lock "Newtonsoft.Json" → lookup called with name "Newtonsoft.Json" */ });
it("manifestsForLockfile expands *.csproj in the lockfile directory", async () => {});
it("npm/pypi behaviour unchanged", async () => { /* re-run Phase 1 scanner suite: npx vitest run packages/osv-language-server/test/core/scanner.test.ts */ });
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).** Then run the full suite: `npm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): extend ecosystem contract for external versions, exact manifests and name keys"`

---

### Task 2: Single-source file patterns

**Files:**
- Create: `scripts/sync-patterns.mjs`
- Modify: `packages/vscode-osv/package.json` (`activationEvents`), `packages/vscode-osv/src/extension.ts` (document selector from a generated module), `.pre-commit-hooks.yaml`, root `package.json` (scripts `sync-patterns`, `check-patterns`), `.github/workflows/ci.yml` (run `check-patterns`)
- Create (generated, committed): `packages/vscode-osv/src/generated/patterns.ts`
- Test: `test/ecosystems/patterns.test.ts`

**Interfaces:**
- Server package exports `allFileGlobs(modules = ALL_MODULES): string[]` (manifests + lockfiles + relatedFiles, deduplicated) and `preCommitFilesRegex(modules = ALL_MODULES): string` (anchored `(^|/)(…)$` alternation translated from the globs; `*` → `[^/]*`).
- `sync-patterns.mjs` imports the built server (`node --import tsx`), writes `activationEvents` (`workspaceContains:**/<glob>` each), `generated/patterns.ts` (`export const DOCUMENT_GLOBS = [...]`), and the `files:` line in `.pre-commit-hooks.yaml`. `--check` mode exits 1 if any output would change.

- [ ] **Step 1: Write failing test** — `preCommitFilesRegex([npmModule, pypiModule])` matches `a/package.json`, `requirements-dev.txt`, `requirements/base.txt`, `pylock.dev.toml` and not `package.json.bak`, `notpackage.json`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).** Run `npm run sync-patterns` then `npm run check-patterns` (exit 0) and the vscode-osv integration test.
- [ ] **Step 5: Commit** — `git commit -m "build: generate client and pre-commit file patterns from ecosystem modules"`

---

### Task 3: XML tokenizer

**Files:**
- Create: `src/core/xml.ts`
- Test: `test/core/xml.test.ts`

**Interfaces:**
- Produces: `parseXml(text: string): XmlElement` (root; throws `ParseError` on unbalanced/unterminated tags) with `interface XmlElement { name: string; attrs: Map<string, { value: string; valueStart: number; valueEnd: number }>; start: number; end: number; text: string; textStart: number; textEnd: number; children: XmlElement[]; parent?: XmlElement }`. `name` without namespace prefix. `text` = concatenated direct text content, trimmed, with `textStart`/`textEnd` the offsets of the trimmed text. Handles comments, CDATA, processing instructions, DOCTYPE, self-closing tags, `'`/`"` attribute quotes; entities in values are decoded in `value` but offsets refer to raw text.
- Produces: `childrenNamed(el: XmlElement, name: string): XmlElement[]`, `childText(el: XmlElement, name: string): XmlElement | undefined`.

- [ ] **Step 1: Write failing tests** — attribute value offsets (`<PackageReference Include="A" Version="1.2.3"/>` → `text.slice(valueStart, valueEnd) === "1.2.3"`), element text offsets with surrounding whitespace, comments containing tags ignored, CRLF, unbalanced → `ParseError`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): add offset-preserving XML tokenizer"`

---

### Task 4: Cargo — requirements and Cargo.toml

**Files:**
- Create: `src/ecosystems/cargo/req.ts`, `src/ecosystems/cargo/manifest.ts`
- Test: `test/ecosystems/cargo/req.test.ts`, `manifest.test.ts`, fixtures `test/fixtures/cargo/`

**Interfaces:**
- Produces: `cargoLowerBound(req: string): string | undefined` — Cargo semantics: comma-separated comparators; bare `1.2` ≡ `^1.2`; `=`, `^`, `~`, `>=`, `>`, `<`, `*`, `1.*`; map to node-semver (bare → `^`, `,` → space) and use `semver.minVersion`; `0.0.0` from a non-literal → `undefined`.
- Produces: `rewriteCargoReq(raw: string, target: string): RewriteResult` — keep operator; keep the original precision (number of components) only if padding the truncated target with zeros equals the target (`"1.2"` + `1.4.0` → `"1.4"`; `"1.2"` + `1.4.3` → `"1.4.3"`); upper bounds the target violates are dropped (`widened`).
- Produces: `parseCargoManifest(text: string): DeclaredDep[]` — tables `dependencies`, `dev-dependencies`, `build-dependencies`, `target.<cfg>.{dependencies,dev-dependencies,build-dependencies}`, `workspace.dependencies`; value string or inline table / dotted sub-table with `version`, `package` (rename → `name` = package value), `git`/`path` (kind), `workspace = true` (kind `unresolved`, flagged by `group` suffix `:workspace` for `resolveExternal`). `group` = the table key (`dependencies`, `dev-dependencies`, `target.cfg(unix).dependencies`, `workspace.dependencies`). Uses Phase 1 `pypi/toml.ts` helpers — move them to `src/core/toml.ts` in this task and update imports.
- Produces: `resolveCargoWorkspace(deps, ctx)` (`resolveExternal`) — for `workspace = true` deps, find the nearest ancestor `Cargo.toml` (up to `rootDir`) containing `[workspace]`, read `[workspace.dependencies]`, and fill `rawSpec`, `lowerBound`, `kind`, `specLocation` (pointing into the workspace file).

- [ ] **Step 1: Write failing tests**

```ts
it.each([["1.2", "1.2.0"], ["=1.2.3", "1.2.3"], ["~1.2", "1.2.0"], [">=1.0, <2", "1.0.0"], ["*", undefined], ["<2", undefined]])("lower bound %s", (r, lb) => expect(cargoLowerBound(r)).toBe(lb));
it.each([["1.2", "1.4.0", "1.4"], ["1.2", "1.4.3", "1.4.3"], ["=1.2.3", "1.4.0", "=1.4.0"], ["^0.6.9", "0.6.10", "^0.6.10"]])("rewrite %s", (raw, t, spec) => expect(rewriteCargoReq(raw, t).spec).toBe(spec));
it("parses tables, renames, git, workspace", () => expect(rows(parseCargoManifest(read("Cargo.toml")))).toEqual([["serde", "dependencies", "1.0.0", "registry"], ["real-name", "dependencies", "1.0.0", "registry"], ["mygit", "dependencies", undefined, "git"], ["smallvec", "target.cfg(unix).dependencies", "0.6.9", "registry"], ["tokio", "dev-dependencies", undefined, "unresolved"]]));
it("resolves workspace = true from the workspace root", async () => { /* member Cargo.toml + root with [workspace.dependencies] tokio = "1.0" → rawSpec "1.0", specLocation.path = root */ });
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(cargo): parse Cargo.toml with workspace inheritance and rewrite requirements"`

---

### Task 5: Cargo — Cargo.lock and module

**Files:**
- Create: `src/ecosystems/cargo/lock.ts`, `src/ecosystems/cargo/index.ts`; Modify: `src/ecosystems/index.ts`
- Test: `test/ecosystems/cargo/lock.test.ts`, `module.test.ts`; fixture `Cargo.lock` generated with `cargo generate-lockfile` from a fixture crate depending on `smallvec = "0.6.9"` and `time = "0.1.42"`

**Interfaces:**
- Produces: `parseCargoLock(text): ResolvedDep[]` — `[[package]]`; root packages = entries without `source`; direct = names in roots' `dependencies`; dependency strings `"name"` or `"name version"` or `"name version (source)"` resolved to nodes `name@version`; `via` from `computeVia`; range = `version` string content.
- Produces: `cargoModule: EcosystemModule` — `id "cargo"`, `osvEcosystem "crates.io"`, `manifests ["Cargo.toml"]`, `lockfiles ["Cargo.lock"]`, `lockfilesForManifest → ["Cargo.lock"]` (resolver walks up, so workspace members find the root lock), `manifestForLockfile → "Cargo.toml"`, `versioning semverComparator`, `normalizeName`: `-`/`_` kept as written (crates.io treats them as distinct for OSV), `resolveExternal resolveCargoWorkspace`, `relatedFiles ["Cargo.toml"]`.
- `lockCommand`: `cargo update -p <name>`. `transitiveFix`: `{ kind: "command-only", edit: [], lockCommand: { cwd: lock dir, command: "cargo update -p <name>@<current> --precise <target>" } }` (uses `TransitiveCtx.current` from Task 1).

- [ ] **Step 1: Write failing tests** — `smallvec` direct at `0.6.9` with range text `"0.6.9"`; a transitive entry has `via`; duplicate package names at two versions both present; `transitiveFix` command string exactly `cargo update -p foo@1.0.0 --precise 1.0.5`; `classifyFile("crates/a/Cargo.toml")?.module.id === "cargo"`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(cargo): parse Cargo.lock and assemble cargo module"`

---

### Task 6: Maven version comparator

**Files:**
- Create: `src/versioning/maven.ts`
- Test: `test/versioning/maven.test.ts`

**Interfaces:**
- Produces: `mavenComparator: Comparator` implementing Maven `ComparableVersion`:

```
tokenize: lowercase; split on "." and "-"; also split at digit↔letter transitions (a "-" or a transition starts a sub-list).
numbers compare numerically; strip trailing zero/"null" items ("1.0.0" == "1", "1-ga" == "1").
qualifier aliases: a→alpha, b→beta, m→milestone (only when followed by a digit), cr→rc, ga/final/release→"".
qualifier order: alpha < beta < milestone < rc < snapshot < "" < sp < (unknown qualifiers, lexical).
number vs qualifier: number > qualifier; list vs number: number > list; list vs qualifier: list > qualifier.
```
`isValid`: starts with a digit. `major`: first numeric item. `normalize`: trim.

- [ ] **Step 1: Write failing tests** — table: `1.0-alpha1 < 1.0-beta1 < 1.0-m1 < 1.0-rc1 < 1.0-SNAPSHOT < 1.0 < 1.0-sp1`, `1.0 == 1.0.0 == 1-ga`, `1.0.1 > 1.0-sp1`, `2.14.1 < 2.15.0`, `1.0-RC1 == 1.0-cr1`, `2.12.2 < 2.14.1`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(versioning): add Maven ComparableVersion comparator"`

---

### Task 7: Maven — pom.xml

**Files:**
- Create: `src/ecosystems/maven/pom.ts`, `src/ecosystems/maven/range.ts`
- Test: `test/ecosystems/maven/pom.test.ts`, `range.test.ts`, fixtures `test/fixtures/maven/`

**Interfaces:**
- Produces: `mavenLowerBound(spec: string): string | undefined` — soft requirement `1.2.3` → `1.2.3`; ranges `[a,b)`, `[a,]`, `(a,b]`: inclusive lower → `a`; exclusive lower or unbounded lower → `undefined`; multiple ranges `[1,2),[3,4)` → first range's lower.
- Produces: `rewriteMavenSpec(raw: string, target: string): RewriteResult` — soft → target; range → replace the lower bound with `[target` and drop an upper bound the target violates (`widened`).
- Produces: `parsePom(text: string): DeclaredDep[]` — `project/dependencies/dependency`, `project/dependencyManagement/dependencies/dependency` (group `dependencyManagement`), `project/build/plugins/plugin` (group `plugins`), `profiles/profile/dependencies/dependency` (group `profile:<id>`); name `groupId:artifactId`; `<version>` text: literal → inline `specRange`; `${prop}` → resolved from same-file `<properties>` (and `${project.version}`/`${project.parent.version}`) → `specLocation` at the property's text, `specRange` at the `${…}` reference; unresolvable property or missing version → `kind: "unresolved"` (keep for `resolveExternal`); `scope` `import`/`system` → skipped.
- Produces: `resolvePomParent(deps, ctx)` (`resolveExternal`) — if `<parent>` exists, read `relativePath` (default `../pom.xml`) within `rootDir`; resolve still-unresolved `${prop}` from the parent's properties and missing versions from the parent's `dependencyManagement` (recursively up to 5 levels); sets `specLocation` into the parent file.

- [ ] **Step 1: Write failing tests**

```ts
it("literal, property, and dependencyManagement versions", () => {
  const deps = parsePom(read("pom.xml"));
  expect(find(deps, "org.apache.logging.log4j:log4j-core")).toMatchObject({ rawSpec: "2.14.1", lowerBound: "2.14.1", kind: "registry" });
  const p = find(deps, "com.fasterxml.jackson.core:jackson-databind"); expect(textAt(read("pom.xml"), p.specLocation!.range)).toBe("2.9.8"); expect(textAt(read("pom.xml"), p.specRange!)).toBe("${jackson.version}");
});
it("undefined property → unresolved, no throw", () => expect(find(parsePom(read("pom-missing-prop.xml")), "a:b").kind).toBe("unresolved"));
it("parent dependencyManagement fills a missing version", async () => {});
it.each([["[1.2,2.0)", "1.2"], ["(1.2,2.0)", undefined], ["[1.0,]", "1.0"]])("lower bound %s", (s, lb) => expect(mavenLowerBound(s)).toBe(lb));
it.each([["2.14.1", "2.17.1", "2.17.1", false], ["[2.0,2.16)", "2.17.1", "[2.17.1,)", true]])("rewrite %s", (r, t, spec, w) => expect(rewriteMavenSpec(r, t)).toEqual({ spec, widened: w }));
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(maven): parse pom.xml with properties and parent resolution"`

---

### Task 8: Gradle — build scripts, version catalog, gradle.lockfile

**Files:**
- Create: `src/ecosystems/maven/gradle.ts`, `catalog.ts`, `gradleLock.ts`
- Test: one test per file, fixtures `build.gradle`, `build.gradle.kts`, `libs.versions.toml`, `gradle.lockfile`

**Interfaces:**
- Produces: `parseGradleBuild(text: string): DeclaredDep[]` — regex heuristics over lines outside `//` and `/* */` comments, for configurations `implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|kapt|ksp|classpath|platform|enforcedPlatform` (and `"…"(…)`-quoted custom names): string notation `conf("g:a:v")`, `conf 'g:a:v'`, `conf(platform("g:a:v"))`; map notation `conf group: 'g', name: 'a', version: 'v'` (Groovy) and `conf(group = "g", name = "a", version = "v")` (Kotlin); version may contain `$var`/`${var}` → resolved from same-file `val var = "…"`/`def var = '…'`/`ext.var = '…'`/`ext { var = '…' }` (else `unresolved`); catalog accessors `libs.foo.bar` (and `libs.bundles.*` skipped) → `kind: "unresolved"`, `group: "catalog:foo.bar"` for `resolveExternal`. Group = configuration name.
- Produces: `parseVersionCatalog(text: string): DeclaredDep[]` — `[libraries]` entries: `"g:a:v"` string, `{ module = "g:a", version = "v" }`, `{ group, name, version }`, `version.ref = "x"` → resolved from `[versions]` with `specLocation` on the `[versions]` value; rich versions `{ strictly | require | prefer }` use the first present. `[plugins]` skipped. Group = `"catalog:" + alias` (alias normalized: `-`, `_` → `.`).
- Produces: `resolveGradleCatalog(deps, ctx)` (`resolveExternal`) — for `catalog:` deps from a build script, locate `gradle/libs.versions.toml` in the build file's directory or ancestors up to `rootDir`, match by normalized alias, and fill `name`, `rawSpec`, `lowerBound`, `kind`, `specLocation`.
- Produces: `parseGradleLockfile(text): ResolvedDep[]` — lines `g:a:v=conf1,conf2`; `empty=` and comments skipped; `direct: false` (scanner marks via manifest); range = `v`.
- Gradle versions use `mavenComparator`; lower bound for `1.+` → `undefined` (dynamic), `[1.0,2.0)` → via `mavenLowerBound`.

- [ ] **Step 1: Write failing tests** — Groovy and Kotlin fixture files yield the same five deps (string, map, platform, `$var`, catalog accessor); a commented-out dependency is not returned; catalog `version.ref` sets `specLocation` on the `[versions]` value; `resolveGradleCatalog` resolves `libs.jackson.databind` from alias `jackson-databind`; lockfile parses `com.fasterxml.jackson.core:jackson-databind:2.9.8=compileClasspath`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(maven): parse Gradle build scripts, version catalogs and gradle.lockfile"`

---

### Task 9: Maven module assembly

**Files:**
- Create: `src/ecosystems/maven/index.ts`; Modify: `src/ecosystems/index.ts`
- Test: `test/ecosystems/maven/module.test.ts`

**Interfaces:**
- Produces: `mavenModule: EcosystemModule` — `id "maven"`, `osvEcosystem "Maven"`, `manifests ["pom.xml", "build.gradle", "build.gradle.kts", "gradle/libs.versions.toml"]`, `lockfiles ["gradle.lockfile", "buildscript-gradle.lockfile"]`, `lockfilesForManifest`: Gradle files → `["gradle.lockfile"]`, `pom.xml` → `[]`; `manifestForLockfile` → `"build.gradle.kts"`, `manifestsForLockfile` → `["build.gradle.kts", "build.gradle"]` (Task 1 hook); `versioning mavenComparator`; `normalizeName` identity; `resolveExternal` dispatches to `resolvePomParent` / `resolveGradleCatalog` by manifest basename; `relatedFiles ["pom.xml", "gradle/libs.versions.toml"]`; `rewriteSpec rewriteMavenSpec`.
- `lockCommand`: Gradle with `gradle.lockfile` → `./gradlew dependencies --write-locks` (`gradlew.bat` on Windows: `process.platform === "win32"`); otherwise `undefined` (Maven has no lockfile).
- `transitiveFix` (only reachable from `gradle.lockfile`): append to the build file (`manifestText`) a block — Kotlin DSL and Groovy both accept:
  ```
  
  dependencies {
      constraints {
          implementation("<g:a>:<target>")
      }
  }
  ```
  `kind: "override"`, lockCommand as above. (No Maven transitive findings exist because `pom.xml` has no lockfile; spec §10.3's `<dependencyManagement>` override is therefore not implemented — YAGNI until a Maven lock source exists.)

- [ ] **Step 1: Write failing tests** — module registration for all four manifest paths; `lockCommand` strings; transitive constraint block appended exactly once at end of file; `scanDocument` on the fixture `pom.xml` with fixtures for log4j records (download `GHSA-jfh8-c2jp-5v3q`, `GHSA-7rjr-3q55-vv33`, `GHSA-p6xc-xr62-6r2g`, `GHSA-8489-44mv-ggj8`) gives target `2.17.1` for `2.14.1`, and a backport check: current `2.12.1` → target `2.12.4` (verify against the downloaded records before asserting; adjust only if the records say otherwise).
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(maven): assemble Maven/Gradle module"`

---

### Task 10: Go module

**Files:**
- Create: `src/ecosystems/go/gomod.ts`, `src/ecosystems/go/index.ts`; Modify: `src/ecosystems/index.ts`
- Test: `test/ecosystems/go/gomod.test.ts`, `module.test.ts`

**Interfaces:**
- Produces: `parseGoMod(text: string): DeclaredDep[]` — `require` single lines and blocks; `// indirect` → `group: "indirect"` else `"require"`; `replace old [v] => new v` applied (a replaced module is reported under the *new* path and version, with `specLocation` at the replace line's version); `=> ./local` → skipped entirely; `exclude` ignored; `module`, `go`, `toolchain` directives ignored. `rawSpec` = version as written (with `v`), `lowerBound` = same.
- Produces: `goComparator: Comparator` — `semverComparator` with `normalize` stripping `v` and `+incompatible`; pseudo-versions compare as semver prereleases.
- Produces: `goModule: EcosystemModule` — `id "go"`, `osvEcosystem "Go"`, `manifests ["go.mod"]`, `lockfiles []`, `manifestIsExact: true`, `lockfilesForManifest → []`, `normalizeName` identity; `rewriteSpec(raw, target)` → `v` + target without `v` duplication; `lockCommand` → `go get <name>@v<target> && go mod tidy` (`LockCtx.target` is the bare version); `transitiveFix` → `undefined` (indirect deps are in `go.mod` and edited directly as manifest findings).

- [ ] **Step 1: Write failing tests** — block + single requires, indirect marking, replace to version re-targets name/version and `specLocation`, replace to `./local` skipped, CRLF; download `GO-2021-0113` and `GO-2022-1059` and assert `golang.org/x/text v0.3.5` → target `0.3.8` and the edit text `v0.3.8`.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(go): add go.mod module"`

---

### Task 11: NuGet comparator and ranges

**Files:**
- Create: `src/versioning/nuget.ts`, `src/ecosystems/nuget/range.ts`
- Test: `test/versioning/nuget.test.ts`, `test/ecosystems/nuget/range.test.ts`

**Interfaces:**
- Produces: `nugetComparator: Comparator` — up to 4 numeric parts (missing = 0), then SemVer 2 prerelease rules with case-insensitive identifier comparison; build metadata ignored; `major` = first part.
- Produces: `nugetLowerBound(spec: string): string | undefined` — `1.0` (minimum inclusive) → `1.0`; `[1.0]` → `1.0`; `[1.0,2.0)` → `1.0`; `(1.0,)` → `undefined`; floating `1.*` → `1.0` ; `*` → `undefined`.
- Produces: `rewriteNugetSpec(raw: string, target: string): RewriteResult` — bare → target; `[x]` → `[target]`; ranges → lower replaced, violated upper dropped (`widened`); floating `1.*` → `target` (`widened: false`).

- [ ] **Step 1: Write failing tests** — `1.0.0.1 > 1.0.0`, `1.0.0-Beta == 1.0.0-beta`, `1.0 == 1.0.0.0`, `12.0.3 < 13.0.1`; lower bounds and rewrites per the rules above.
- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(versioning): add NuGet comparator and version ranges"`

---

### Task 12: NuGet parsers and module

**Files:**
- Create: `src/ecosystems/nuget/project.ts`, `packagesConfig.ts`, `lock.ts`, `index.ts`; Modify: `src/ecosystems/index.ts`
- Test: one test per parser + `module.test.ts`, fixtures `test/fixtures/nuget/`

**Interfaces:**
- Produces: `parseProjectFile(text: string): DeclaredDep[]` (csproj/fsproj/vbproj/`Directory.Build.props`) — `PackageReference` with `Include` (or `Update`) and `Version`/`VersionOverride` attribute or child element; no version → `kind: "unresolved"`, `group: "cpm"` for `resolveExternal`; `$(Prop)` versions resolved from same-file `<PropertyGroup>` (else `unresolved`) with `specLocation`.
- Produces: `parsePackagesProps(text: string): DeclaredDep[]` (`Directory.Packages.props`) — `PackageVersion Include Version`, plus `GlobalPackageReference`.
- Produces: `parsePackagesConfig(text: string): DeclaredDep[]` — `<package id version>`.
- Produces: `parseNugetLock(text: string): ResolvedDep[]` — `dependencies.<tfm>.<name>` with `type` (`Direct` → direct), `resolved`; edges from each entry's `dependencies`; deduplicate `name@resolved` across target frameworks (first range wins); range = `resolved` value content.
- Produces: `resolveCentralVersions(deps, ctx)` (`resolveExternal`) — for `cpm` deps, nearest `Directory.Packages.props` up to `rootDir`; match `Include` case-insensitively; fill `rawSpec`, `lowerBound`, `kind`, `specLocation` into the props file.
- Produces: `nugetModule: EcosystemModule` — `id "nuget"`, `osvEcosystem "NuGet"`, `manifests ["*.csproj", "*.fsproj", "*.vbproj", "Directory.Packages.props", "Directory.Build.props", "packages.config"]`, `lockfiles ["packages.lock.json"]`, `lockfilesForManifest`: project files and `packages.config` → `["packages.lock.json"]`, props → `[]`; `manifestForLockfile` → `undefined`, `manifestsForLockfile` → `["*.csproj", "*.fsproj", "*.vbproj"]` (expanded by Task 1); `normalizeName` identity (casing preserved for OSV); `nameKey` lowercase; `versioning nugetComparator`; `rewriteSpec rewriteNugetSpec`; `relatedFiles ["Directory.Packages.props", "Directory.Build.props"]`; `lockCommand` → `dotnet restore --force-evaluate` when a lockfile exists, else `dotnet restore`; `transitiveFix` → `undefined` (advice only).

- [ ] **Step 1: Write failing tests**

```ts
it("csproj attribute, child element, property and CPM", async () => { /* four PackageReference forms → names/specs; CPM resolved from Directory.Packages.props with specLocation in the props file */ });
it("lock dedupes target frameworks", () => expect(parseNugetLock(read("packages.lock.json")).filter(d => d.name === "Newtonsoft.Json")).toHaveLength(1));
it("queries with lockfile casing", async () => { /* csproj declares "newtonsoft.json" 12.0.3; lock has "Newtonsoft.Json"; download GHSA-5crp-9r3c-p9vr; scanDocument → finding name "Newtonsoft.Json", target "13.0.1", crossesMajor true */ });
it("packages.config", () => {});
```

- [ ] **Step 2–4: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 5: Commit** — `git commit -m "feat(nuget): parse project files, central package management, packages.config and packages.lock.json"`

---

### Task 13: End-to-end coverage, docs, release

**Files:**
- Create: `test/fixtures/repos/{cargo,maven,gradle,go,nuget}/` (one vulnerable fixture project each)
- Modify: `test/cli.test.ts`, `test/server.test.ts`, `test/canary/live.test.ts`, `README.md`, `docs/agents.md`, `docs/pre-commit.md`, `packages/vscode-osv/CHANGELOG.md`
- Modify (generated): run `npm run sync-patterns`

**Interfaces:**
- CLI test: each fixture repo exits 1 and reports the expected `name current → target` line (fake OSV loaded with the records downloaded in Tasks 5, 9, 10, 12).
- Server test: opening `Cargo.toml`, `pom.xml` (property-defined version → code action edits the `<properties>` value), `go.mod`, `*.csproj` with CPM (code action edits `Directory.Packages.props`) produces diagnostics.
- Canary: adds `log4j-core 2.14.1` (Maven), `golang.org/x/text v0.3.5` (Go), `Newtonsoft.Json 12.0.3` (NuGet), `smallvec 0.6.9` (crates.io).
- Docs: README supported-files table gains the four ecosystems; `docs/agents.md` filetypes/root markers updated; `docs/pre-commit.md` regex note updated; CHANGELOG entry.

- [ ] **Step 1: Write the failing CLI/server tests** → run → FAIL for the new fixtures.
- [ ] **Step 2: Fix any integration gaps** until they pass; run `npm run sync-patterns && npm run check-patterns`.
- [ ] **Step 3: Full verification** — `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run test:integration -w vscode-osv && scripts/test-precommit.sh` all pass; `npm run test:canary` passes.
- [ ] **Step 4: Commit** — `git commit -m "feat: release Phase 2 ecosystems (Rust, Java/Kotlin, Go, C#)"`
