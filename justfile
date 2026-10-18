# Task runner for vs-code-osv. Run `just` to list recipes.
# Wraps the npm scripts in package.json and the steps in .github/workflows/ci.yml.
# Requires: node >= 20, npm, just. Integration tests on Linux also need xvfb-run.

set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# Install dependencies exactly as package-lock.json pins them
install:
    npm ci

# Fast local gate: the CI checks that run on every platform, plus the build
check: lint typecheck check-patterns test build

# Everything CI runs, including packaging, integration and the pre-commit end-to-end test
ci: check package integration precommit

lint:
    npm run lint

typecheck:
    npm run typecheck

# Fails if the generated pattern files are out of date with the module list
check-patterns:
    npm run check-patterns

# Regenerate the pattern files (package.json activation events, patterns.ts, .pre-commit-hooks.yaml)
sync-patterns:
    npm run sync-patterns

# Unit and integration-style tests (vitest). Extra arguments filter by path or name, e.g. `just test hex`
test *args:
    npm test -- {{args}}

# Tests that query live api.osv.dev. Not part of `just test`; needs network access
canary:
    npm run test:canary

build:
    npm run build

# Build and package the VSIX into packages/vscode-osv (no publish)
package:
    npm run package -w vscode-osv

# Opens a scratch copy of a fixture under test/fixtures/repos, so fixes that edit files
# never touch the committed fixture. Pick another fixture with `just vscode actions`.
# Build, then open VS Code with the extension loaded from source (Extension Development Host)
vscode fixture="vulnerable": build
    #!/usr/bin/env bash
    set -euo pipefail
    src="packages/osv-language-server/test/fixtures/repos/{{fixture}}"
    [ -d "$src" ] || { echo "No fixture named '{{fixture}}' under packages/osv-language-server/test/fixtures/repos" >&2; exit 1; }
    dir="$(mktemp -d)"
    cp -r "$src/." "$dir"
    code --new-window --extensionDevelopmentPath="$PWD/packages/vscode-osv" "$dir"
    echo "Opened $dir with the extension loaded from $PWD/packages/vscode-osv"

# VS Code extension integration tests, headless on Linux
[linux]
integration:
    xvfb-run -a npm run test:integration -w vscode-osv

# VS Code extension integration tests on a desktop session
[macos]
integration:
    npm run test:integration -w vscode-osv

[windows]
integration:
    npm run test:integration -w vscode-osv

# End-to-end pre-commit hook test. Needs `pre-commit` on PATH (pip install pre-commit)
precommit:
    scripts/test-precommit.sh

# Run the osv-check CLI on paths (default: the current directory) using the built server
scan *paths=".": build
    node packages/osv-language-server/dist/cli.js {{paths}}

# Bump both package versions and the pre-commit pin to X.Y.Z. Edits files only; review and commit by hand
release-prepare version:
    node scripts/release-prepare.mjs {{version}}

# Remove build output and packaged VSIX files
clean:
    rm -rf packages/osv-language-server/dist packages/vscode-osv/dist packages/vscode-osv/*.vsix
