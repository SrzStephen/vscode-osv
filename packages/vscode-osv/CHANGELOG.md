# Changelog

## 0.1.0

Initial release.

- Vulnerability diagnostics, hover and quick fixes for npm, PyPI, Rust (`Cargo.toml`, `Cargo.lock`), Java/Kotlin (`pom.xml`, Gradle build files, version catalogs and lockfiles), Go (`go.mod`), C# (`*.csproj`, central package management, `packages.config`, `packages.lock.json`), Ruby (`Gemfile`, `gems.rb`, `*.gemspec`, `Gemfile.lock`, `gems.locked`), PHP (`composer.json`, `composer.lock`), GitHub Actions (workflow files and `action.yml`), Dart/Flutter (`pubspec.yaml`, `pubspec.lock`), Elixir (`mix.exs`, `mix.lock`) and Swift (`Package.swift`, `Package.resolved`) manifests and lockfiles.
- Compound requirements (such as a Gemfile `'~> 2.2', '>= 2.2.3'`) are fixed by raising the lower bound and keeping the rest.
- Property- and catalog-defined versions are fixed at their definition (Maven `<properties>`, Gradle version catalogs, NuGet `Directory.Packages.props`).
- GitHub Actions refs are matched against OSV records on the client, since OSV has no versioned entries for actions.
- Lockfile refresh offer after a fix, status bar, workspace scan, offline cache.
- `osv-check` CLI and pre-commit hook.
- Known limitations of the heuristic parsers are listed in the README.
