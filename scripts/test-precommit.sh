#!/usr/bin/env bash
# End-to-end test of the pre-commit hook defined in .pre-commit-hooks.yaml.
#
# Builds and packs the server, creates a throwaway git repo with a vulnerable
# requirements.txt, points a .pre-commit-config.yaml at this checkout, and checks
# that `pre-commit run --all-files` fails on the vulnerable version (exit 1,
# mentions `requests`) and passes once the version is fixed (exit 0).
#
# Needs: node/npm, git, the `pre-commit` tool, and network access (OSV API, npm registry).
# Env: PRE_COMMIT    path to the pre-commit executable (default: pre-commit on PATH)
#      VULN_VERSION  requests version expected to be vulnerable (default 2.19.0)
#      FIXED_VERSION requests version expected to be clean (default 2.33.0)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRE_COMMIT="${PRE_COMMIT:-pre-commit}"
VULN_VERSION="${VULN_VERSION:-2.19.0}"
FIXED_VERSION="${FIXED_VERSION:-2.33.0}"

fail() { echo "FAIL: $*" >&2; exit 1; }
command -v "$PRE_COMMIT" >/dev/null 2>&1 || fail "pre-commit executable not found (set PRE_COMMIT)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export PRE_COMMIT_HOME="$WORK/pre-commit-home"
export XDG_CACHE_HOME="$WORK/xdg-cache"
export GIT_CONFIG_GLOBAL="$WORK/gitconfig"
git config --global user.name "osv-test"
git config --global user.email "osv-test@example.invalid"
git config --global init.defaultBranch main

echo "== build and pack the server"
(cd "$ROOT" && npm run build -w osv-language-server >/dev/null)
TARBALL_DIR="$WORK/tarball"
mkdir -p "$TARBALL_DIR"
(cd "$ROOT" && npm pack --silent -w osv-language-server --pack-destination "$TARBALL_DIR" >/dev/null 2>&1)
TARBALL="$(ls "$TARBALL_DIR"/*.tgz)"

echo "== snapshot this checkout as the hook repo"
# pre-commit installs hooks from a committed rev, so clone HEAD and overlay the
# working-tree hook definition and root package.json (they may not be committed yet).
HOOK_REPO="$WORK/hook-repo"
git clone -q "$ROOT" "$HOOK_REPO"
for f in .pre-commit-hooks.yaml package.json; do
  if [ -f "$ROOT/$f" ]; then cp "$ROOT/$f" "$HOOK_REPO/$f"; fi
done
git -C "$HOOK_REPO" add -A
git -C "$HOOK_REPO" commit -q --allow-empty -m "snapshot"
REV="$(git -C "$HOOK_REPO" rev-parse HEAD)"
[ -f "$HOOK_REPO/.pre-commit-hooks.yaml" ] || fail ".pre-commit-hooks.yaml is missing"

echo "== create the vulnerable project"
PROJ="$WORK/project"
mkdir -p "$PROJ"
git -C "$PROJ" init -q
printf 'requests==%s\n' "$VULN_VERSION" > "$PROJ/requirements.txt"
cat > "$PROJ/.pre-commit-config.yaml" <<YAML
default_language_version:
  node: system
repos:
  - repo: file://$HOOK_REPO
    rev: $REV
    hooks:
      - id: osv-check
        additional_dependencies: ["$TARBALL"]
YAML
git -C "$PROJ" add -A
git -C "$PROJ" commit -q -m "initial"

echo "== run 1: expect failure"
set +e
OUT1="$(cd "$PROJ" && "$PRE_COMMIT" run --all-files 2>&1)"
RC1=$?
set -e
echo "$OUT1"
[ "$RC1" -eq 1 ] || fail "expected exit 1 for vulnerable requirements.txt, got $RC1"
grep -q "requests" <<<"$OUT1" || fail "output does not mention requests"

echo "== run 2: fix the version, expect success"
printf 'requests==%s\n' "$FIXED_VERSION" > "$PROJ/requirements.txt"
git -C "$PROJ" add -A
set +e
OUT2="$(cd "$PROJ" && "$PRE_COMMIT" run --all-files 2>&1)"
RC2=$?
set -e
echo "$OUT2"
[ "$RC2" -eq 0 ] || fail "expected exit 0 after fixing the version, got $RC2"

echo "PASS: pre-commit hook fails on requests==$VULN_VERSION and passes on requests==$FIXED_VERSION"
