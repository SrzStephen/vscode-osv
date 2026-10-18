import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCargoLock } from "../../../src/ecosystems/cargo/lock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { textAt } from "../../helpers/textAt.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "cargo", "Cargo.lock"), "utf8");

describe("parseCargoLock", () => {
  const deps = parseCargoLock(text);

  it("reports smallvec as direct with the version text as range", () => {
    const smallvec = deps.find((d) => d.name === "smallvec")!;
    expect(smallvec).toMatchObject({ version: "0.6.9", direct: true });
    expect(smallvec.via).toBeUndefined();
    expect(textAt(text, smallvec.range)).toBe("0.6.9");
  });

  it("derives via for transitive packages and omits the root crate", () => {
    expect(deps.find((d) => d.name === "libc")).toMatchObject({ direct: false, via: ["time"] });
    expect(deps.find((d) => d.name === "fixture")).toBeUndefined();
  });

  it("keeps duplicate package names at two versions", () => {
    const lock = `version = 4

[[package]]
name = "app"
version = "0.1.0"
dependencies = [
 "foo 1.0.0",
 "bar",
]

[[package]]
name = "bar"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
dependencies = [
 "foo 2.0.0 (registry+https://github.com/rust-lang/crates.io-index)",
]

[[package]]
name = "foo"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "foo"
version = "2.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;
    const parsed = parseCargoLock(lock);
    expect(parsed.filter((d) => d.name === "foo").map((d) => [d.version, d.direct, d.via])).toEqual([
      ["1.0.0", true, undefined],
      ["2.0.0", false, ["bar"]],
    ]);
  });

  it("throws ParseError on invalid TOML", () => {
    expect(() => parseCargoLock("[[package")).toThrow(ParseError);
  });
});
