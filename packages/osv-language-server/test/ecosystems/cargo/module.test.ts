import { describe, expect, it } from "vitest";
import { cargoModule } from "../../../src/ecosystems/cargo/index.js";
import { classifyFile } from "../../../src/ecosystems/index.js";
import { resolveVersion } from "../../../src/core/lockfileResolver.js";

describe("cargoModule", () => {
  it("builds the cargo update --precise command", () =>
    expect(
      cargoModule.transitiveFix({ name: "foo", current: "1.0.0", target: "1.0.5", lockfilePath: "/p/Cargo.lock" }),
    ).toEqual({
      kind: "command-only",
      edit: [],
      lockCommand: { cwd: "/p", command: "cargo update -p foo@1.0.0 --precise 1.0.5" },
    }));

  it("refuses shell-unsafe names", () =>
    expect(cargoModule.transitiveFix({ name: "a;b", current: "1.0.0", target: "1.0.5", lockfilePath: "/p/Cargo.lock" })).toBeUndefined());

  it("lock command updates the package", () =>
    expect(cargoModule.lockCommand({ manifestPath: "/p/Cargo.toml", name: "foo", target: "1.0.5" })).toBe("cargo update -p foo"));

  it("keeps crate names as written", () => expect(cargoModule.normalizeName("a_b-c")).toBe("a_b-c"));

  it("classifies workspace member manifests and lockfiles", () => {
    expect(classifyFile("crates/a/Cargo.toml")?.module.id).toBe("cargo");
    expect(classifyFile("Cargo.lock")).toMatchObject({ role: "lockfile" });
  });

  it("checks each declaration of a crate on two majors at its own locked version", () => {
    const manifest = ["[package]", 'name = "app"', 'version = "0.1.0"', "", "[dependencies]", 'rand07 = { package = "rand", version = "0.7" }', 'rand = "0.8"', ""].join("\n");
    const lock = [
      "version = 4",
      "",
      "[[package]]",
      'name = "app"',
      'version = "0.1.0"',
      'dependencies = ["rand 0.7.3", "rand 0.8.5"]',
      "",
      "[[package]]",
      'name = "rand"',
      'version = "0.7.3"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      "",
      "[[package]]",
      'name = "rand"',
      'version = "0.8.5"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      "",
    ].join("\n");
    const deps = cargoModule.parseManifest(manifest, "Cargo.toml");
    const locked = cargoModule.parseLockfile(lock, "Cargo.lock");
    expect(locked.filter((r) => r.direct).map((r) => r.version)).toEqual(["0.7.3", "0.8.5"]);
    const checked = deps.map((d) => ({ lowerBound: d.lowerBound, resolved: resolveVersion(d, locked, cargoModule) }));
    expect(checked).toEqual([
      { lowerBound: "0.7.0", resolved: { version: "0.7.3", fromLockfile: true, name: "rand" } },
      { lowerBound: "0.8.0", resolved: { version: "0.8.5", fromLockfile: true, name: "rand" } },
    ]);
  });
});
