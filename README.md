# OSV Vulnerabilities

Find known vulnerabilities in your dependencies while you edit, and fix them in one click.
Dependency manifests and lockfiles are checked against [OSV.dev](https://osv.dev), and every
finding is shown right on the line that declares the package.

This repository contains:

| Package | What it is |
|---|---|
| [`packages/vscode-osv`](packages/vscode-osv) | The VS Code extension (a thin client) |
| [`packages/osv-language-server`](packages/osv-language-server) | The language server, plus the `osv-check` CLI for pre-commit hooks and CI |

Supported ecosystems: **npm**, **PyPI**, **Rust** (Cargo), **Java/Kotlin** (Maven and Gradle), **Go** and **C#** (NuGet).

## Features

- **Inline diagnostics** on manifests and lockfiles, with severity from CVSS scores
  (critical/high are errors, medium is a warning, low is information).
- **Hover details** for each vulnerable package: IDs, aliases, severity, summaries, links.
- **One-click fixes**: update a dependency to the lowest version that fixes the vulnerabilities,
  with the manifest edit preserving your range style (`^`, `~`, `>=`, ...). Transitive
  dependencies are fixed with overrides/resolutions where the package manager supports them.
- **Lockfile refresh**: after a fix, offers to run the right command (`npm install`,
  `uv lock`, ...) in a visible terminal. Disabled in Restricted Mode.
- **Status bar**: `OSV: N vulnerable` / `OSV: ✓` / `OSV: offline` for the active editor.
- **Offline friendly**: results are cached on disk and served (marked `cached`) when OSV.dev
  is unreachable.
- **Ignore list**: suppress a vulnerability from settings or from an `osv-scanner.toml`.
- **Pre-commit and CI**: the `osv-check` command, see [docs/pre-commit.md](docs/pre-commit.md).
- **Any editor or AI agent** that speaks LSP: see [docs/agents.md](docs/agents.md).

<!-- TODO: add recorded GIFs before release (Task 25 checklist) -->

### Supported files

| Ecosystem | Files |
|---|---|
| npm | `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock` |
| PyPI | `requirements*.txt`, `requirements/*.txt`, `pyproject.toml`, `Pipfile`, `Pipfile.lock`, `poetry.lock`, `uv.lock`, `pdm.lock`, `pylock.toml`, `pylock.*.toml` |
| Rust (crates.io) | `Cargo.toml`, `Cargo.lock` |
| Java/Kotlin (Maven) | `pom.xml`, `build.gradle`, `build.gradle.kts`, `gradle/libs.versions.toml`, `gradle.lockfile`, `buildscript-gradle.lockfile` |
| Go | `go.mod` |
| C# (NuGet) | `*.csproj`, `*.fsproj`, `*.vbproj`, `Directory.Packages.props`, `Directory.Build.props`, `packages.config`, `packages.lock.json` |

## Privacy

- Only package name, version and ecosystem are sent, and only to `osv.apiBaseUrl`.
- No file contents, paths, project names, or identifiers are sent. No telemetry.

## Settings

| Setting | Default | Description |
|---|---|---|
| `osv.enable` | `true` | Master switch (workspace-scoped) |
| `osv.ecosystems` | all enabled | Object of per-ecosystem booleans, e.g. `{ "npm": true, "pypi": false }` |
| `osv.minimumSeverity` | `"low"` | Hide findings below this level |
| `osv.scanLockfiles` | `true` | Highlight entries inside lockfiles |
| `osv.scanWorkspaceOnStartup` | `false` | Run workspace scan when the server starts |
| `osv.cacheTtlHours` | `48` | Package-result freshness, minimum 1 |
| `osv.apiBaseUrl` | `"https://api.osv.dev"` | OSV API base (mirror/proxy) |
| `osv.ignoredVulnerabilities` | `[]` | Vulnerability IDs (any alias) to suppress |
| `osv.offerLockCommand` | `"ask"` | `ask` \| `always` \| `never` |

**Ignore file:** an `osv-scanner.toml` in the workspace root (or any ancestor of the scanned
file up to the root) is read for `[[IgnoredVulns]]` entries (`id`, optional `ignoreUntil`,
`reason`). Expired `ignoreUntil` entries are not applied. Matching is by any alias.

## Commands

- `OSV: Scan workspace`
- `OSV: Clear cache and rescan`
- `OSV: Show output log`

## Documentation

- [Pre-commit hooks and CI](docs/pre-commit.md)
- [Using the language server from AI agents and other editors](docs/agents.md)
- [Design specification](docs/superpowers/specs/2026-10-18-osv-vscode-extension-design.md)

## Development

```
npm ci
npm run build
npm test
npm run lint
npm run typecheck
scripts/test-precommit.sh     # needs the pre-commit tool and network access
```
