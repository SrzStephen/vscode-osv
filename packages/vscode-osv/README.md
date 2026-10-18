# OSV Vulnerabilities for VS Code

Highlights known vulnerabilities ([OSV.dev](https://osv.dev)) in npm and PyPI dependency
manifests and lockfiles, with one-click fixes.

## Features

- Inline diagnostics on manifests and lockfiles, with severity from CVSS.
- Hover details and `Update <package> to <version>` quick fixes that preserve your range style.
- Offers to refresh the lockfile after a fix (never in Restricted Mode).
- Status bar: `OSV: N vulnerable`, `OSV: ✓` or `OSV: offline`; click to open the Problems panel.
- Works offline from a disk cache.

<!-- TODO(release): replace with real recordings before publishing (Task 25 checklist). -->
![Inline diagnostics and hover](media/diagnostics.gif)
![One-click fix](media/quick-fix.gif)

## Privacy

- Only package name, version and ecosystem are sent, and only to `osv.apiBaseUrl`.
- No file contents, paths, project names, or identifiers are sent. No telemetry.

## Settings

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

An `osv-scanner.toml` with `[[IgnoredVulns]]` entries (`id`, optional `ignoreUntil`, `reason`)
in the workspace root is also honoured.

## Commands

`OSV: Scan workspace`, `OSV: Clear cache and rescan`, `OSV: Show output log`.

## More

Pre-commit hooks, CI and other editors: see the
[repository README](../../README.md), [pre-commit docs](../../docs/pre-commit.md) and
[agent docs](../../docs/agents.md).
