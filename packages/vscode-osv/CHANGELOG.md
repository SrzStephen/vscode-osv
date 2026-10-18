# Changelog

## 1.0.0

- Add Ruby (`Gemfile`, `gems.rb`, `*.gemspec`, `Gemfile.lock`, `gems.locked`), PHP (`composer.json`, `composer.lock`), GitHub Actions (workflow files and `action.yml`), Dart/Flutter (`pubspec.yaml`, `pubspec.lock`), Elixir (`mix.exs`, `mix.lock`) and Swift (`Package.swift`, `Package.resolved`) support.
- Compound requirements (such as a Gemfile `'~> 2.2', '>= 2.2.3'`) are fixed by raising the lower bound and keeping the rest.
- GitHub Actions refs are matched against OSV records on the client, since OSV has no versioned entries for actions.
- Known limitations of the heuristic parsers are listed in the README.
- Add Rust (`Cargo.toml`, `Cargo.lock`), Java/Kotlin (`pom.xml`, Gradle build files, version catalogs and lockfiles), Go (`go.mod`) and C# (`*.csproj`, central package management, `packages.config`, `packages.lock.json`) support.
- Property- and catalog-defined versions are fixed at their definition (Maven `<properties>`, Gradle version catalogs, NuGet `Directory.Packages.props`).
- `osv-check` and the pre-commit hook cover the new file types.

## 0.1.0

Initial release.

- Vulnerability diagnostics, hover and quick fixes for npm and PyPI manifests and lockfiles.
- Lockfile refresh offer after a fix, status bar, workspace scan, offline cache.
- `osv-check` CLI and pre-commit hook.
