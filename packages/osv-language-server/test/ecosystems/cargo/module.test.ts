import { describe, expect, it } from "vitest";
import { cargoModule } from "../../../src/ecosystems/cargo/index.js";
import { classifyFile } from "../../../src/ecosystems/index.js";

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
});
