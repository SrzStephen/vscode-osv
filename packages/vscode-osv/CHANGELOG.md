# Changelog

## Unreleased

- Add Rust (`Cargo.toml`, `Cargo.lock`), Java/Kotlin (`pom.xml`, Gradle build files, version catalogs and lockfiles), Go (`go.mod`) and C# (`*.csproj`, central package management, `packages.config`, `packages.lock.json`) support.
- Property- and catalog-defined versions are fixed at their definition (Maven `<properties>`, Gradle version catalogs, NuGet `Directory.Packages.props`).
- `osv-check` and the pre-commit hook cover the new file types.

## 0.1.0

Initial release.

- Vulnerability diagnostics, hover and quick fixes for npm and PyPI manifests and lockfiles.
- Lockfile refresh offer after a fix, status bar, workspace scan, offline cache.
- `osv-check` CLI and pre-commit hook.
