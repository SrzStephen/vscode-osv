# OSV Dependency Vulnerability Highlighter — Design

**Date:** 2026-10-18
**Status:** Draft for review
**Author:** Stephen Mott (with Claude)

## 1. Summary

A VS Code extension, backed by a standalone language server, that highlights vulnerable
dependencies in manifest and lockfiles across 12 package ecosystems, using
[osv.dev](https://osv.dev) as the only vulnerability source. Each finding suggests the
lowest version that fixes all known vulnerabilities and offers a one-click update that
rewrites the manifest while preserving its range style, then offers the ecosystem's lock
command. The same engine is exposed over plain LSP (for AI agents and other editors) and
as an `osv-check` CLI (for pre-commit hooks and CI).

## 2. Goals and non-goals

### Goals

- Highlight vulnerable dependencies in manifests **and** lockfiles (including transitive
  entries) for: Python, Rust, Java/Kotlin, JavaScript, Go, C#, Ruby, PHP, GitHub Actions,
  Dart, Elixir, Swift.
- Suggest an upgrade target computed purely from OSV data.
- Hover with details and a "click to update" action; equivalent quick fix via code actions.
- Expose all functionality through standard LSP so AI agents (e.g. Claude Code LSP plugins)
  and other editors can consume it.
- Provide a CLI with documented, tested pre-commit hook examples.
- Ship publicly to the VS Code Marketplace, Open VSX, and npm.

### Non-goals

- Querying package registries (npm, PyPI, crates.io, …). The suggested version is OSV-only.
- Running package managers automatically. Lock commands run only after an explicit click.
- Wrapping or bundling `osv-scanner` (evaluated and rejected: no source positions in its
  output, most manifests unsupported, no Swift/GitHub Actions, per-platform binary).
- vscode.dev / browser-only support (the server requires Node).
- An MCP server (may be added later as a thin layer over the same core).
- Telemetry of any kind.
- Reachability / call-graph analysis.

## 3. Key decisions

| Topic | Decision |
|---|---|
| Audience | Public: VS Code Marketplace + Open VSX + npm |
| Vulnerability source | osv.dev API only (`/v1/querybatch`, `/v1/vulns/{id}`) |
| Implementation | Native TypeScript; position-aware parsers per ecosystem |
| Process model | Standalone LSP server (`osv-language-server`) + thin VS Code client |
| Version checked | Lockfile-resolved version when a lockfile exists; otherwise the spec's lower bound |
| Lockfiles | Also highlighted, including transitive entries |
| Suggested version | Lowest version fixing **all** known vulns for the package, from OSV `fixed` events |
| Update action | Rewrite manifest preserving range style → offer lock command in a terminal |
| Cache | Shared on-disk cache, per-entry files, default TTL **48 h** |
| CLI | `osv-check`, same core, for pre-commit and CI |
| Delivery | One spec, three releasable phases (§17) |

## 4. Architecture

### 4.1 Repository layout

npm-workspaces monorepo, TypeScript (strict), bundled with esbuild. Server targets Node ≥ 20.

```
packages/
  osv-language-server/          npm package; bins: osv-language-server, osv-check
    src/
      server.ts                 LSP wiring (vscode-languageserver/node)
      cli.ts                    osv-check entry point
      core/
        scanner.ts              text → Finding[] pipeline for one document
        workspaceScanner.ts     discover files, dedupe triples, scan all
        lockfileResolver.ts     locate lockfile for a manifest; name → resolved version
        osvClient.ts            HTTP to OSV: batching, concurrency, retry/backoff
        cache.ts                on-disk cache, atomic per-entry files, TTL
        fixCalculator.ts        min-fix computation (pure)
        severity.ts             CVSS / database_specific → Severity (pure)
        aliases.ts              merge alias-linked vulns (GHSA ↔ CVE)
        ignores.ts              settings + osv-scanner.toml ignore handling
        types.ts                shared types (§5)
      ecosystems/
        index.ts                registry of modules
        npm/ pypi/ cargo/ maven/ go/ nuget/
        rubygems/ packagist/ githubActions/ pub/ hex/ swift/
      versioning/               one comparator per scheme
        semver.ts pep440.ts maven.ts nuget.ts rubygems.ts go.ts
        composer.ts hex.ts pub.ts
      features/
        diagnostics.ts          Finding → lsp.Diagnostic
        hover.ts                Finding → markdown
        codeActions.ts          Finding → quickfix WorkspaceEdit
        commands.ts             workspace/executeCommand handlers
  vscode-osv/                   VS Code extension (thin client)
    src/
      extension.ts              starts bundled server via vscode-languageclient
      statusBar.ts              counts diagnostics with source "osv" for active editor
      commandRunner.ts          handles osv/suggestLockCommand → notification → terminal
docs/
  pre-commit.md
  agents.md                     Claude Code / Neovim / generic LSP setup
.pre-commit-hooks.yaml
```

### 4.2 Unit boundaries

- **Parsers** are pure: `text → DeclaredDep[] | ResolvedDep[]`. No I/O.
- **Comparators** are pure: `compare(a, b)`, `isValid(v)`, `normalize(v)`.
- **fixCalculator** is pure: `(vulns, package, currentVersion, comparator) → FixResult`.
- **osvClient** is the only module that performs network I/O.
- **cache** is the only module that performs cache file I/O.
- **features/** convert `Finding[]` into LSP types; they never query OSV.
- The **VS Code client** contains no scanning logic; it only starts the server and adds
  VS Code-specific UI (status bar, terminal).

## 5. Core types

```ts
type Severity = "critical" | "high" | "medium" | "low" | "unknown";

interface TextRange { start: { line: number; character: number }; end: { line: number; character: number } }

interface DeclaredDep {            // from a manifest
  name: string;                    // ecosystem-normalized (see §6.2)
  rawSpec: string | undefined;     // e.g. "^1.2.3", ">=2.0,<3"; undefined if no version
  nameRange: TextRange;
  specRange: TextRange | undefined;
  lowerBound: string | undefined;  // derived from rawSpec; undefined if unresolvable
  kind: "registry" | "git" | "path" | "url" | "unresolved"; // only "registry" is checked
  group?: string;                  // e.g. "devDependencies", "dev", "test"
}

interface ResolvedDep {            // from a lockfile
  name: string;
  version: string;
  range: TextRange;                // squiggle location (the version, else the entry)
  direct: boolean;
  via?: string[];                  // dependency path from a direct dep, when derivable
}

interface Vuln {                   // merged alias group
  id: string;                      // preferred ID (GHSA > ecosystem-native > CVE)
  aliases: string[];
  summary: string;
  severity: Severity;
  modified: string;
}

interface FixResult {
  target: string | undefined;      // undefined → no fix available
  fixesAll: boolean;
  crossesMajor: boolean;
  reason?: "no-fixed-event" | "unparseable-version" | "no-matching-range";
}

interface Finding {
  uri: string;
  range: TextRange;
  ecosystem: string;               // OSV ecosystem name
  name: string;
  current: string;
  source: "manifest" | "lockfile";
  direct: boolean;
  via?: string[];
  vulns: Vuln[];                   // after ignores and severity filter
  severity: Severity;              // max over vulns
  fix: FixResult;
  update?: UpdatePlan;             // absent when no fix or no edit possible
  cached: boolean;                 // true if served from stale cache while offline
}

interface UpdatePlan {
  edit: { uri: string; range: TextRange; newText: string }[]; // manifest edit(s)
  lockCommand?: { cwd: string; command: string };
  kind: "direct" | "override" | "command-only";
}
```

`Finding` is also the JSON schema for `osv.getFindings`, `osv.scanWorkspace`, and
`osv-check --format json`.

## 6. Ecosystem modules

### 6.1 Interface

```ts
interface EcosystemModule {
  id: string;                         // "npm", "pypi", ...
  osvEcosystem: string;               // "npm", "PyPI", "crates.io", ...
  manifests: string[];                // glob patterns
  lockfiles: string[];                // glob patterns, in lookup-preference order
  versioning: Comparator;
  normalizeName(name: string): string;
  parseManifest(text: string, fileName: string): DeclaredDep[];
  parseLockfile(text: string, fileName: string): ResolvedDep[];
  rewriteSpec(rawSpec: string, target: string): string;   // preserves operator style
  lockCommand(ctx: LockCtx): string | undefined;          // after a direct edit
  transitiveFix(ctx: TransitiveCtx): UpdatePlan | undefined;
}
```

Parsers use position-preserving libraries: `jsonc-parser` (JSON), a TOML parser that
exposes source offsets (or a small offset-tracking wrapper), an XML SAX parser with
offsets, `yaml` (with CST ranges), and line-based parsing for line formats. Formats that
are code (`build.gradle(.kts)`, `mix.exs`, `Package.swift`) use documented regex
heuristics covering the common declaration forms; unmatched forms are skipped silently.

### 6.2 Ecosystem matrix

| Module | OSV ecosystem | Manifests | Lockfiles | Versioning | Name normalization |
|---|---|---|---|---|---|
| npm | `npm` | `package.json` | `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock` | semver (node-semver ranges) | as-is |
| pypi | `PyPI` | `requirements*.txt`, `pyproject.toml` (PEP 621, Poetry, uv), `Pipfile` | `poetry.lock`, `uv.lock`, `Pipfile.lock`, `pdm.lock`, `pylock.toml` | PEP 440 | PEP 503 (lowercase, `[-_.]+` → `-`); extras stripped |
| cargo | `crates.io` | `Cargo.toml` | `Cargo.lock` | semver (Cargo semantics: bare `1.2` = `^1.2`) | as-is |
| maven | `Maven` | `pom.xml`, `build.gradle`, `build.gradle.kts`, `gradle/libs.versions.toml` | `gradle.lockfile` | Maven ComparableVersion | `groupId:artifactId` |
| go | `Go` | `go.mod` | `go.mod` (see note) | Go semver incl. pseudo-versions, `+incompatible` | module path |
| nuget | `NuGet` | `*.csproj`, `*.fsproj`, `*.vbproj`, `Directory.Packages.props`, `packages.config` | `packages.lock.json` | NuGet (4-part, case-insensitive) | lowercase for matching |
| rubygems | `RubyGems` | `Gemfile`, `*.gemspec` | `Gemfile.lock`, `gems.locked` | RubyGems | as-is |
| packagist | `Packagist` | `composer.json` | `composer.lock` | Composer | lowercase |
| githubActions | `GitHub Actions` | `.github/workflows/*.y{a,}ml`, `action.y{a,}ml` | — | semver on tags; SHAs skipped | `owner/repo` (subpath dropped) |
| pub | `Pub` | `pubspec.yaml` | `pubspec.lock` | Pub (semver variant) | as-is |
| hex | `Hex` | `mix.exs` | `mix.lock` | Hex (semver) | as-is |
| swift | `SwiftURL` | `Package.swift` | `Package.resolved` | semver | repo URL normalized to `github.com/owner/repo` form |

Notes:
- **Go:** since Go 1.17 `go.mod` lists all modules needed for the build with their
  selected versions, so it is treated as both manifest and lockfile; `go.sum` is not used.
  `replace` directives are honoured (the replacement version is checked; local-path
  replacements are skipped).
- **Maven/Gradle:** `${property}` references in `pom.xml` are resolved from the same file's
  `<properties>` and the parent POM if it is in the workspace; otherwise `kind:"unresolved"`.
  Gradle catalog references (`libs.foo`) resolve through `gradle/libs.versions.toml`.
- **NuGet central package management:** a `<PackageReference>` without a version resolves
  through `Directory.Packages.props`; the edit targets the props file.
- **GitHub Actions:** only `uses: owner/repo[/path]@ref` with a tag ref is checked. Branch
  refs and commit SHAs are skipped. Docker and local actions are skipped.

### 6.3 Range-style preservation (`rewriteSpec`)

The operator and structure of the original spec are preserved; only the version that
determines the minimum is replaced. Examples:

| Ecosystem | Before | After (target 1.4.0 / 2.5) |
|---|---|---|
| npm | `^1.2.3` · `~1.2.3` · `1.2.3` · `>=1.2.3 <2` | `^1.4.0` · `~1.4.0` · `1.4.0` · `>=1.4.0 <2` |
| PyPI | `==2.0` · `>=2.0,<3` · `~=2.0` | `==2.5` · `>=2.5,<3` · `~=2.5` |
| Cargo | `"1.2"` · `"=1.2.3"` | `"1.4"` (same precision) · `"=1.4.0"` |
| RubyGems | `"~> 1.4"` · `">= 1.2", "< 2"` | `"~> 1.6"` (same precision) · `">= 1.6", "< 2"` |
| Maven | `1.2.3` · `[1.2,2.0)` | `1.4.0` · `[1.4.0,2.0)` |

If the target falls outside an explicit upper bound (e.g. `>=2.0,<3` → 3.1), the upper
bound is removed and the hover warns that the constraint was widened. If the version comes
from a property/catalog entry, the edit targets that definition.

## 7. Data flow

### 7.1 Triggers

- `textDocument/didOpen`, `didChange` (debounced 750 ms), `didSave` for any file matching a
  module's manifest or lockfile patterns.
- `workspace/didChangeWatchedFiles` for lockfiles (registered dynamically) → rescan open
  manifests that resolve through the changed lockfile.
- `osv.scanWorkspace` command, or startup if `osv.scanWorkspaceOnStartup` is true.
- A newer scan of a document cancels any in-flight scan of the same document.

### 7.2 Pipeline (per document)

1. **Parse** with the matching module.
2. **Resolve versions.**
   - Manifest: find the nearest lockfile among the module's lockfile patterns, searching the
     manifest's directory then parents up to the workspace folder root. Map
     `normalizeName(name) → version`. If no lockfile or no entry: use `lowerBound`.
     Skip deps with `kind ≠ "registry"` or no resolvable version (`*`, `latest`, `<2.0`).
   - Lockfile: versions are exact; all entries checked (when `osv.scanLockfiles` is true).
3. **Query OSV** (§8) for unique `(ecosystem, name, version)` triples.
4. **Filter** by ignore list and `osv.minimumSeverity`; merge aliases.
5. **Compute fix** (§7.3) and **update plan** (§10.3).
6. **Publish** `Finding[]` → diagnostics; retain for hover, code actions, commands.

### 7.3 Fix calculation

Inputs: the full OSV records for the package's vulns, the current version, the comparator.

```
fixPoints = []
for vuln in vulns:
  affected = entries in vuln.affected where package.ecosystem and normalized name match
  ranges   = ECOSYSTEM and SEMVER ranges of those entries (GIT ignored)
  r = the range whose [introduced, fixed|last_affected) contains current
  if r has no "fixed" event: return { target: undefined, reason: "no-fixed-event" }
  fixPoints.push(r.fixed)
  (if no range contains current but OSV reported the vuln, use the lowest "fixed" > current;
   if none: reason "no-matching-range")

candidate = max(fixPoints)
loop:
  if candidate is inside any affected range of any vuln: candidate = next fixed event
                                                          above candidate in that range
  else break
  (no next fixed event → target undefined, reason "no-fixed-event")

return { target: candidate, fixesAll: true,
         crossesMajor: major(candidate) > major(current) }
```

Versions that the comparator cannot parse yield `reason: "unparseable-version"`; the
finding still appears without an update action.

## 8. OSV client

- `POST {apiBaseUrl}/v1/querybatch` with up to 1000 queries per request; one batch request
  in flight at a time per process. Handles `next_page_token` pagination.
- `GET {apiBaseUrl}/v1/vulns/{id}` for each vuln ID not already cached at the same
  `modified` timestamp; at most 8 concurrent.
- Retry 429 / 5xx / network errors: 3 attempts, exponential backoff with jitter, honour
  `Retry-After`.
- Proxy: in VS Code the client passes `http.proxy` to the server; standalone uses
  `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`.
- User-Agent: `osv-language-server/<version>`.
- Request body contains only package name, ecosystem, and version.

## 9. Cache

- **Location:** VS Code → the extension's `globalStorageUri` (passed in
  `initializationOptions.cacheDir`); standalone → `$XDG_CACHE_HOME/osv-language-server`
  (Linux), `~/Library/Caches/osv-language-server` (macOS), `%LOCALAPPDATA%\osv-language-server\Cache`
  (Windows). Overridable via `--cache-dir` / `OSV_CACHE_DIR`.
- **Layout:** `pkg/<sha256(ecosystem|name|version)>.json` →
  `{ fetchedAt, vulnIds: [{id, modified}] }`; `vuln/<sha256(id)>.json` → full OSV record.
- **Writes:** write to `<file>.<pid>.<rand>.tmp`, then `rename` (atomic on all supported
  platforms). Concurrent servers/CLI processes share the cache safely; last writer wins.
- **TTL:** package entries are fresh for `osv.cacheTtlHours` (default **48**, min 1). Vuln
  records are reused while their `modified` matches the batch response.
- **In-memory layer:** LRU in front of disk, per process.
- **Offline:** if OSV is unreachable, stale entries are served and findings marked
  `cached: true`.
- **Clear:** `osv.clearCache` deletes the cache directory contents and rescans.
- **Housekeeping:** on startup, delete package entries older than 7× TTL.

## 10. LSP surface

### 10.1 Capabilities

- `textDocumentSync: Incremental`
- `hoverProvider: true`
- `codeActionProvider: { codeActionKinds: ["quickfix"] }`
- `executeCommandProvider: { commands: ["osv.update", "osv.scanWorkspace", "osv.getFindings", "osv.clearCache", "osv.ignore"] }`
- Diagnostics are **pushed** via `textDocument/publishDiagnostics`.

### 10.2 Diagnostics

- `range`: the version spec (manifest), else the package name; the version (lockfile).
- `severity`: critical/high → Error; medium → Warning; low/unknown → Information.
  Severity derives from CVSS v3/v4 base score (`severity[]`), else
  `database_specific.severity`, else `unknown`.
- `source`: `"osv"`; `code`: preferred ID of the most severe vuln;
  `codeDescription.href`: `https://osv.dev/vulnerability/<id>`.
- `message` is self-sufficient for agents that only read diagnostics:
  `lodash 4.17.15 has 3 known vulnerabilities (GHSA-p6mc-m468-83gw, GHSA-29mw-wpgm-hmr9, CVE-2020-28500); upgrade to 4.17.21 (fixes all)`
  with suffixes `(transitive, via express → body-parser)`, `(major version upgrade)`,
  `no fixed version available`, `(cached)` as applicable.
- `data`: `{ ecosystem, name, current, target, vulnIds, direct, lockCommand }`.

### 10.3 Code actions and update plans

- One `quickfix` per finding with an `UpdatePlan`, titled `Update <name> to <target>`
  (or `Override <name> to <target>` for transitive overrides), marked `isPreferred`.
- The action carries the `WorkspaceEdit` and a `command: osv.update` with the finding key,
  so the server can follow up with the lock-command notification.
- **Direct dep in manifest:** edit the spec (or the property/catalog/props definition).
- **Direct dep clicked in a lockfile:** edit the corresponding manifest declaration.
- **Transitive dep:** per module `transitiveFix`:
  - npm: `overrides` (npm), `resolutions` (yarn), `pnpm.overrides` (pnpm) edit, or
    `npm update <name>` command.
  - Cargo: `cargo update -p <name> --precise <target>` (command-only).
  - PyPI: `poetry update <name>` / `uv lock --upgrade-package <name>` (command-only).
  - Maven: `<dependencyManagement>` override edit; Gradle: `constraints { }` edit.
  - RubyGems: `bundle update --conservative <name>`; Composer: `composer update <name>`;
    others: advice only (hover text, no action).
- **Lock commands after a direct edit:** npm/yarn/pnpm/bun install, `cargo update -p`,
  `poetry lock` / `uv lock` / `pipenv lock`, `go get <mod>@<v> && go mod tidy`,
  `dotnet restore`, `bundle install`, `composer update <name>`, `dart pub get`,
  `mix deps.update <name>`, `swift package update`. Chosen from which lockfile exists.

### 10.4 Commands (`workspace/executeCommand`)

| Command | Args | Returns |
|---|---|---|
| `osv.update` | `{ uri, findingKey }` | applies edit via `workspace/applyEdit`; then sends `osv/suggestLockCommand` |
| `osv.scanWorkspace` | `{ minimumSeverity? }` | `Finding[]` for all matching files |
| `osv.getFindings` | `{ uri }` | `Finding[]` for one document |
| `osv.clearCache` | — | `null`; rescans open documents |
| `osv.ignore` | `{ id }` | if the client set `initializationOptions.clientHandlesIgnore` (VS Code does), sends `osv/addIgnore { id }` and the client updates `osv.ignoredVulnerabilities`; otherwise appends an `[[IgnoredVulns]]` entry to the workspace-root `osv-scanner.toml` via `workspace/applyEdit` (creating the file if needed) |

### 10.5 Custom notification

- `osv/suggestLockCommand` (server → client): `{ cwd: string, command: string }`. Optional;
  clients that do not handle it ignore it. The same command is in the diagnostic `data`.
- `osv/addIgnore` (server → client): `{ id: string }`. Sent only to clients that declared
  `clientHandlesIgnore` (see §10.4).

### 10.6 Configuration

Settings arrive via `initializationOptions.settings` and `workspace/didChangeConfiguration`
(§12). Standalone clients may also use `workspace/configuration` pull.

## 11. VS Code client

- Starts the bundled server (Node IPC) via `vscode-languageclient`; document selector covers
  all manifest and lockfile patterns.
- Passes `cacheDir` (globalStorageUri), proxy settings, and `osv.*` settings.
- **Hover command links** (`command:osv.update?…`) are enabled via trusted markdown limited
  to the extension's own commands.
- **Status bar:** `$(shield) OSV: N vulnerable` / `$(shield) OSV: ✓` / `$(shield) OSV: offline`
  for the active editor; click → Problems panel filtered to source `osv`.
- **`osv/suggestLockCommand`:** honours `osv.offerLockCommand`:
  - `ask` → notification "Run `<command>` to update the lockfile?" [Run in terminal]
    [Dismiss] [Always] [Never] (Always/Never update the setting);
  - `always` → run immediately in a named terminal `OSV` with `cwd`;
  - `never` → nothing.
- **`osv/addIgnore`:** appends the ID to `osv.ignoredVulnerabilities` in workspace settings
  (the client sets `clientHandlesIgnore: true` at initialization).
- **Restricted Mode (untrusted workspace):** scanning, hover and edits work; running lock
  commands is disabled.
- **Commands:** `OSV: Scan workspace`, `OSV: Clear cache and rescan`, `OSV: Show output log`.

## 12. Settings

| Setting | Default | Description |
|---|---|---|
| `osv.enable` | `true` | Master switch (workspace-scoped) |
| `osv.ecosystems` | all enabled | Object of per-ecosystem booleans |
| `osv.minimumSeverity` | `"low"` | Hide findings below this level |
| `osv.scanLockfiles` | `true` | Highlight entries inside lockfiles |
| `osv.scanWorkspaceOnStartup` | `false` | Run workspace scan when the server starts |
| `osv.cacheTtlHours` | `48` | Package-result freshness, minimum 1 |
| `osv.apiBaseUrl` | `"https://api.osv.dev"` | OSV API base (mirror/proxy) |
| `osv.ignoredVulnerabilities` | `[]` | Vulnerability IDs (any alias) to suppress |
| `osv.offerLockCommand` | `"ask"` | `ask` \| `always` \| `never` |

**Ignore file:** an `osv-scanner.toml` in the workspace root (or any ancestor of the
scanned file up to the root) is read for `[[IgnoredVulns]]` entries (`id`, optional
`ignoreUntil`, `reason`). Expired `ignoreUntil` entries are not applied. Matching is by
any alias.

## 13. `osv-check` CLI

```
osv-check [paths...]
  --min-severity low|medium|high|critical   default: low
  --format text|json                         default: text
  --strict                                   OSV unreachable without cache → exit 2
  --no-lockfiles                             skip lockfile entries
  --cache-dir <dir>                          override cache location
  --api-base-url <url>                       override OSV API base
```

- No paths → discover all matching files under the current directory (skipping
  `node_modules`, `target`, `vendor`, `.git`, `dist`, `build`). Non-matching paths given
  explicitly are ignored (so pre-commit can pass any staged file).
- **Exit codes:** `0` no findings at/above threshold; `1` findings; `2` usage error, or
  network failure under `--strict`.
- **Offline:** uses cache (including stale); with no cache, prints a warning to stderr and
  exits `0` unless `--strict`.
- **Text output:** one line per finding:
  `package.json:14:18  high  lodash 4.17.15 → 4.17.21  GHSA-p6mc-m468-83gw, +2 more`
  followed by a summary line.
- **JSON output:** `{ "findings": Finding[], "offline": boolean }` on stdout.
- Reads ignores from `osv-scanner.toml`; shares the on-disk cache with the server.

### 13.1 Pre-commit documentation (`docs/pre-commit.md`)

Documented, CI-tested examples:

1. **pre-commit framework** — the repo ships `.pre-commit-hooks.yaml`:
   ```yaml
   - id: osv-check
     name: osv-check
     entry: osv-check
     language: node
     files: (^|/)(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock|requirements[^/]*\.txt|pyproject\.toml|Pipfile(\.lock)?|poetry\.lock|uv\.lock|pdm\.lock|pylock\.toml|Cargo\.(toml|lock)|pom\.xml|build\.gradle(\.kts)?|libs\.versions\.toml|gradle\.lockfile|go\.mod|[^/]*\.(cs|fs|vb)proj|Directory\.Packages\.props|packages\.(config|lock\.json)|Gemfile(\.lock)?|gems\.locked|[^/]*\.gemspec|composer\.(json|lock)|pubspec\.(yaml|lock)|mix\.(exs|lock)|Package\.(swift|resolved)|\.github/workflows/[^/]+\.ya?ml|action\.ya?ml)$
   ```
   User config:
   ```yaml
   repos:
     - repo: https://github.com/<org>/vscode-osv
       rev: v1.0.0
       hooks:
         - id: osv-check
           args: [--min-severity, high]
   ```
   (The `files` regex grows with each phase; Phase 1 ships npm and PyPI patterns only.)
2. **Plain git hook** — a `.git/hooks/pre-commit` shell script that collects staged paths
   (`git diff --cached --name-only --diff-filter=ACM`), exits `0` immediately if none are
   staged, and otherwise runs `npx --yes osv-check <paths...>`. (Exiting early matters:
   `osv-check` with no paths scans the whole tree.)
3. **Husky** and **lefthook** snippets.
4. **CI** — GitHub Actions step: `npx --yes osv-check --strict --format json`.

## 14. Cross-cutting concerns

### 14.1 Privacy

- Only package name, version and ecosystem are sent, and only to `osv.apiBaseUrl`.
- No file contents, paths, project names, or identifiers are sent. No telemetry.
- Documented in the README and Marketplace listing.

### 14.2 Error handling

| Condition | Behaviour |
|---|---|
| OSV unreachable | Serve stale cache, mark `(cached)`; with no cache, status bar `OSV: offline`, log reason; no popups |
| Parse error (e.g. half-typed JSON) | Keep last good findings for that document; log at debug |
| Module throws | Isolated per module/document; other ecosystems unaffected; logged |
| Unparseable version | Finding shown, no update action, message notes the reason |
| Malformed OSV record | Skipped and logged with its ID |
| Edit target changed before apply | Rescan; inform the user if the fix no longer applies |

### 14.3 Security

- The server only reads workspace files and calls the OSV API; it never executes
  processes.
- Lock commands run only on explicit user action in VS Code, in a visible terminal, and
  never in Restricted Mode.
- Hover markdown is trusted only for the extension's own command IDs; OSV-provided text
  (summaries) is escaped.

### 14.4 Performance

- Parsing is synchronous and per-document; target < 50 ms for a 5,000-entry lockfile.
- Warm-cache scan of an open manifest publishes diagnostics in < 200 ms after the debounce.
- Workspace scan deduplicates triples across files before querying.

## 15. Testing

All suites except the live canary run offline.

1. **Parser unit tests (vitest)** per module with fixture files covering edge cases
   (comments, workspaces, extras, environment markers, Maven properties, Gradle catalogs,
   `replace` directives, central package management). Assertions include exact ranges.
2. **Comparator tests**, table-driven per scheme, including PEP 440 pre/post/dev, Maven
   qualifiers, NuGet 4-part, Go pseudo-versions and `+incompatible`, RubyGems `.pre`.
3. **fixCalculator tests** using saved real OSV records: single range, multiple ranges with
   backports, `last_affected` without fix, aliases, target itself vulnerable, crosses major.
4. **rewriteSpec tests** for every operator style per ecosystem, including upper-bound
   widening and property/catalog targets.
5. **osvClient and cache tests** with undici `MockAgent`: batching and pagination, 429 with
   `Retry-After`, offline stale serving, TTL expiry, concurrent writes from two processes.
6. **LSP protocol tests**: spawn the server over stdio and drive it with `vscode-jsonrpc`
   (didOpen → diagnostics, hover, code action → applyEdit, executeCommand, notification).
7. **CLI tests**: exit codes, text and JSON output, offline/strict behaviour, on fixture
   repos. The documented pre-commit config runs in CI against a sample repo.
8. **VS Code integration smoke test** (`@vscode/test-electron`): fixture `package.json` →
   diagnostics, hover command link, update edit, status bar text.
9. **Live canary** (nightly, non-blocking): known-vulnerable packages against
   api.osv.dev to detect API or data-shape drift.

## 16. Packaging and release

- GitHub Actions CI: lint, typecheck, tests on Linux/macOS/Windows.
- Tag-triggered release: VSIX via `vsce` (Marketplace) and `ovsx` (Open VSX);
  `osv-language-server` to npm (with both bins).
- VSIX bundles the server; no platform-specific builds.
- README: feature GIFs, privacy section, settings, links to `docs/pre-commit.md` and
  `docs/agents.md` (Claude Code LSP plugin config, Neovim `lspconfig`, generic stdio).
- CHANGELOG, icon, Marketplace categories (Linters, Other), keywords.

## 17. Phases

Each phase has its own implementation plan and ends in a releasable state.

| Phase | Scope |
|---|---|
| **1. Core + JavaScript + Python** | Monorepo; server; VS Code client; `osv-check`; OSV client; cache; fix calculator; severity; aliases; ignores; diagnostics; hover; code actions; update + lock-command flow; status bar; workspace scan; pre-commit and agent docs; CI/release. Modules: **npm**, **pypi** (all files in §6.2). |
| **2. Core ecosystems** | Modules: **cargo**, **maven** (Maven + Gradle), **go**, **nuget**. |
| **3. Extras** | Modules: **rubygems**, **packagist**, **githubActions**, **pub**, **hex**, **swift**. |

## 18. Risks and open questions

- **Code-based manifests** (`build.gradle(.kts)`, `mix.exs`, `Package.swift`) are parsed
  heuristically; unusual declaration styles will be missed (documented limitation).
- **Lower-bound fallback** without a lockfile can flag ranges that would resolve to a safe
  version; the hover states "checked lower bound — no lockfile found".
- **OSV data quality** varies by ecosystem (e.g. missing `fixed` events); surfaced as
  "no fixed version available" rather than guessed.
- **osv.dev rate limits** are not formally published; the client is conservative and the
  `apiBaseUrl` setting allows a mirror.
- **Repository owner/name** for the published GitHub repo (used in the pre-commit `repo:`
  URL, shown as `<org>/vscode-osv`) and the Marketplace publisher ID must be chosen before
  the Phase 1 release.
- **Claude Code LSP integration** specifics (plugin manifest format) are validated during
  Phase 1 when writing `docs/agents.md`.
