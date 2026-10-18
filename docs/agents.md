# Using the OSV language server from agents and other editors

`osv-language-server` is a standard LSP server. Any LSP client can use it: Claude Code, Neovim,
Helix, Zed, Emacs, and so on. It reads npm, PyPI, Cargo, Maven/Gradle, Go, NuGet, RubyGems, Packagist, GitHub Actions, Pub, Hex and Swift
manifests and lockfiles, queries
[OSV.dev](https://osv.dev) for each package name and version, and publishes the results as
diagnostics.

## Starting the server

```
npx --yes osv-language-server --stdio
```

- Transport: stdio (`--stdio`). `--node-ipc` is also supported.
- Optional: `--cache-dir <dir>` (or `--cache-dir=<dir>`) overrides the cache location. The
  `cacheDir` initialization option does the same and wins over the command-line flag.
- Requires Node 20 or later. The server only reads workspace files and calls the OSV API; it
  never executes processes.

Files handled: `package.json`, `package-lock.json`, `npm-shrinkwrap.json`,
`yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `requirements*.txt`, `requirements/*.txt`,
`pyproject.toml`, `Pipfile`, `Pipfile.lock`, `poetry.lock`, `uv.lock`, `pdm.lock`,
`pylock.toml`, `pylock.*.toml`, `Cargo.toml`, `Cargo.lock`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `gradle/libs.versions.toml`, `gradle.lockfile`, `buildscript-gradle.lockfile`, `go.mod`, `*.csproj`, `*.fsproj`, `*.vbproj`, `Directory.Packages.props`, `Directory.Build.props`, `packages.config`, `packages.lock.json`, `Gemfile`, `gems.rb`, `*.gemspec`, `Gemfile.lock`, `gems.locked`, `composer.json`, `composer.lock`, `.github/workflows/*.yml`, `.github/workflows/*.yaml`, `action.yml`, `action.yaml`, `pubspec.yaml`, `pubspec.lock`, `mix.exs`, `mix.lock`, `Package.swift` and `Package.resolved`. Documents the server does not recognise are ignored, so it is
safe to attach it to every JSON, TOML, YAML or text buffer. Only `file:` URIs are scanned.

The server has no language of its own: the client chooses which buffers to open with it (by
file type or extension) and sends `textDocument/didOpen` / `didChange` as usual.

## `initializationOptions`

All fields are optional. Unknown keys are dropped and invalid values fall back to defaults.

```jsonc
{
  "settings": {
    "enable": true,                      // master switch
    "ecosystems": { "npm": true, "pypi": true, "cargo": true, "maven": true, "go": true, "nuget": true, "rubygems": true, "packagist": true, "githubActions": true, "pub": true, "hex": true, "swift": true }, // per-module booleans; unlisted = enabled
    "minimumSeverity": "low",            // "low" | "medium" | "high" | "critical"
    "scanLockfiles": true,               // report entries inside lockfiles
    "scanWorkspaceOnStartup": false,
    "cacheTtlHours": 48,                 // minimum 1
    "apiBaseUrl": "https://api.osv.dev",
    "ignoredVulnerabilities": [],        // IDs (any alias) to suppress
    "offerLockCommand": "ask"            // "ask" | "always" | "never"
  },
  "cacheDir": "/path/to/cache",          // default: per-user cache directory
  "clientHandlesIgnore": false           // true: osv.ignore sends osv/addIgnore instead of editing osv-scanner.toml
}
```

Settings can be changed later with `workspace/didChangeConfiguration`. If the client advertises
`workspace.didChangeWatchedFiles.dynamicRegistration`, the server registers watchers for
lockfiles and `osv-scanner.toml` so diagnostics refresh when they change on disk.

## Diagnostics

Diagnostics are pushed with `textDocument/publishDiagnostics`.

- `source`: `"osv"`. `code`: the ID of the most severe vulnerability.
  `codeDescription.href`: `https://osv.dev/vulnerability/<id>`.
- `severity`: critical/high are Error, medium is Warning, low/unknown are Information.
- `message` is self-sufficient for agents that only read diagnostics, for example:
  `lodash 4.17.15 has 3 known vulnerabilities (GHSA-p6mc-m468-83gw, GHSA-29mw-wpgm-hmr9, CVE-2020-28500); upgrade to 4.17.21 (fixes all)`.
  Variants and suffixes: `; no fixed version available`,
  `; version could not be parsed, no fix calculated`, `(fixes all)` / `(does not fix all)`,
  `(transitive, via a → b)`, `(major version upgrade)`,
  `(checked lower bound — no lockfile found)`, `(cached)`.
- `data`:

```ts
interface OsvDiagnosticData {
  key: string;            // stable finding key; pass to osv.update as findingKey
  ecosystem: string;      // OSV ecosystem name, e.g. "npm", "PyPI"
  name: string;           // package name
  current: string;        // current (locked or declared lower-bound) version
  target?: string;        // recommended fixed version; absent when no fix exists
  vulnIds: string[];      // IDs of the vulnerabilities in the finding
  direct: boolean;        // true for a direct dependency
  lockCommand?: { cwd: string; command: string }; // command (run in cwd) that refreshes the lockfile after the fix
}
```

Code actions: one `quickfix` per finding that has a fix, titled `Update <name> to <target>`
(or `Override <name> to <target>` for transitive overrides), marked preferred. Hover shows
the vulnerabilities, severities and summaries.

## `workspace/executeCommand`

The server advertises these commands in `executeCommandProvider`.

| Command | Args | Returns |
|---|---|---|
| `osv.update` | `{ uri, findingKey }` | Applies the edit via `workspace/applyEdit`, then sends `osv/suggestLockCommand` |
| `osv.scanWorkspace` | `{ minimumSeverity? }` | `Finding[]` for all matching files |
| `osv.getFindings` | `{ uri }` | `Finding[]` for one document |
| `osv.clearCache` | none | `null`; rescans open documents |
| `osv.ignore` | `{ id }` | If the client set `clientHandlesIgnore`, sends `osv/addIgnore { id }` and the client records it in `ignoredVulnerabilities`; otherwise appends an `[[IgnoredVulns]]` entry to the workspace-root `osv-scanner.toml` via `workspace/applyEdit` (creating the file if needed) |

(`osv.afterUpdate` is also advertised; it is an internal follow-up used by code actions and
is not meant to be called directly.)

Server-to-client notifications (all optional; clients that do not handle them ignore them):

- `osv/suggestLockCommand`: `{ cwd: string, command: string }`. The same object is in the
  diagnostic `data.lockCommand`.
- `osv/addIgnore`: `{ id: string }`. Sent only to clients that set `clientHandlesIgnore`.
- `osv/status`: `{ offline: boolean }`. Sent when the server's online state changes:
  `offline: true` when OSV.dev could not be reached and results come from the cache (or are
  missing), `offline: false` once a scan reaches OSV.dev again.

For headless use (CI, scripts) prefer the CLI, see [pre-commit.md](pre-commit.md).

## Claude Code (LSP plugin)

Claude Code loads LSP servers from plugins. The plugin manifest format below follows the
Claude Code plugin reference ("Plugin manifest reference", `lspServers`) as of Claude Code
2.1.x. Verify against the current docs before publishing, as the format may change.

```
osv-vulnerabilities/
  .claude-plugin/plugin.json
  .lsp.json
```

`.claude-plugin/plugin.json`:

```json
{
  "name": "osv-vulnerabilities",
  "version": "0.1.0",
  "description": "OSV.dev vulnerability diagnostics for npm, PyPI, Cargo, Maven/Gradle, Go, NuGet, RubyGems, Packagist, GitHub Actions, Pub, Hex and Swift manifests and lockfiles",
  "lspServers": "./.lsp.json"
}
```

`.lsp.json` (`lspServers` entries are keyed by server name; `command` has no spaces, arguments
go in `args`):

```json
{
  "osv": {
    "command": "npx",
    "args": ["--yes", "osv-language-server", "--stdio"],
    "extensionToLanguage": {
      ".json": "json",
      ".toml": "toml",
      ".txt": "pip-requirements",
      ".lock": "lock",
      ".yaml": "yaml",
      ".xml": "xml",
      ".gradle": "groovy",
      ".kts": "kotlin",
      ".mod": "gomod",
      ".lockfile": "lock",
      ".csproj": "xml",
      ".fsproj": "xml",
      ".vbproj": "xml",
      ".props": "xml",
      ".config": "xml"
    },
    "initializationOptions": {
      "settings": { "minimumSeverity": "medium" }
    }
  }
}
```

Test it locally with `claude --plugin-dir ./osv-vulnerabilities`, and check the manifest with
`claude plugin validate ./osv-vulnerabilities`. Claude then sees OSV diagnostics after it
edits a dependency file.

Note: `extensionToLanguage` maps extensions to language IDs, so the server is attached to every
file with those extensions; it ignores the ones that are not manifests or lockfiles.

## Neovim

Neovim 0.11 or later (`vim.lsp.config`):

```lua
vim.lsp.config('osv', {
  cmd = { 'npx', '--yes', 'osv-language-server', '--stdio' },
  filetypes = { 'json', 'jsonc', 'toml', 'yaml', 'requirements', 'text', 'xml', 'groovy', 'gradle', 'kotlin', 'gomod', 'ruby', 'elixir', 'swift' },
  root_markers = { 'package.json', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Directory.Packages.props', 'Gemfile', 'composer.json', 'pubspec.yaml', 'mix.exs', 'Package.swift', '.git' },
  init_options = {
    settings = { minimumSeverity = 'medium' },
  },
})
vim.lsp.enable('osv')
```

With `nvim-lspconfig` on older versions:

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.osv then
  configs.osv = {
    default_config = {
      cmd = { 'npx', '--yes', 'osv-language-server', '--stdio' },
      filetypes = { 'json', 'jsonc', 'toml', 'yaml', 'requirements', 'text', 'xml', 'groovy', 'gradle', 'kotlin', 'gomod', 'ruby', 'elixir', 'swift' },
      root_dir = lspconfig.util.root_pattern('package.json', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Directory.Packages.props', 'Gemfile', 'composer.json', 'pubspec.yaml', 'mix.exs', 'Package.swift', '.git'),
      init_options = { settings = { minimumSeverity = 'medium' } },
    },
  }
end
lspconfig.osv.setup({})
```

Run a command from Neovim, for example a workspace scan:

```lua
vim.lsp.buf_request(0, 'workspace/executeCommand', { command = 'osv.scanWorkspace', arguments = { {} } },
  function(_, result) vim.print(result) end)
```
