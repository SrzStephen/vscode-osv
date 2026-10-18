import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePubspec } from "../../../src/ecosystems/pub/pubspec.js";
import { ParseError } from "../../../src/ecosystems/types.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "pub", "pubspec.yaml"), "utf8");

describe("parsePubspec", () => {
  const deps = parsePubspec(text);
  const dep = (name: string) => deps.find((d) => d.name === name)!;

  it("skips sdk dependencies", () => {
    expect(deps.map((d) => d.name)).not.toContain("flutter");
    expect(deps.map((d) => d.name)).not.toContain("flutter_test");
  });

  it("groups by key", () => {
    expect(dep("http").group).toBe("dependencies");
    expect(dep("test").group).toBe("dev_dependencies");
    expect(dep("collection").group).toBe("dependency_overrides");
  });

  it("derives lower bounds", () => {
    expect(dep("http")).toMatchObject({ rawSpec: "0.12.0", lowerBound: "0.12.0", kind: "registry" });
    expect(dep("path")).toMatchObject({ rawSpec: "^1.8.0", lowerBound: "1.8.0" });
    expect(dep("ranged")).toMatchObject({ rawSpec: ">=1.2.0 <2.0.0", lowerBound: "1.2.0" });
    expect(dep("hosted_dep")).toMatchObject({ rawSpec: "^3.1.0", lowerBound: "3.1.0", kind: "registry" });
  });

  it("keeps quotes out of the spec range", () => {
    expect(dep("quoted").rawSpec).toBe("^2.0.0");
    const r = dep("quoted").specRange!;
    const line = text.split("\n")[r.start.line]!;
    expect(line.slice(r.start.character, r.end.character)).toBe("^2.0.0");
  });

  it("marks any and missing versions unresolved", () => {
    expect(dep("anything")).toMatchObject({ kind: "unresolved", rawSpec: "any" });
    expect(dep("anything").lowerBound).toBeUndefined();
    expect(dep("bare")).toMatchObject({ kind: "unresolved" });
    expect(dep("bare").rawSpec).toBeUndefined();
  });

  it("maps git and path dependencies to their kinds", () => {
    expect(dep("git_dep").kind).toBe("git");
    expect(dep("path_dep").kind).toBe("path");
  });

  it("throws ParseError on invalid YAML", () => {
    expect(() => parsePubspec("a: [")).toThrow(ParseError);
  });
});
