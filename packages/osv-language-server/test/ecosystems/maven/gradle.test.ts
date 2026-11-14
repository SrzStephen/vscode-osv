import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeclaredDep } from "../../../src/core/types.js";
import { nodeFileSource } from "../../../src/core/fileSource.js";
import { parseGradleBuild } from "../../../src/ecosystems/maven/gradle.js";
import { parseVersionCatalog, resolveGradleCatalog } from "../../../src/ecosystems/maven/catalog.js";
import { parseGradleLockfile } from "../../../src/ecosystems/maven/gradleLock.js";
import { textAt } from "../../helpers/textAt.js";

const dir = join(__dirname, "..", "..", "fixtures", "maven");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const find = (deps: DeclaredDep[], name: string) => deps.find((d) => d.name === name)!;

describe.each(["build.gradle", "build.gradle.kts"])("parseGradleBuild %s", (file) => {
  const text = read(file);
  const deps = parseGradleBuild(text);

  it("yields the same five deps and ignores comments, bundles and project()", () => {
    expect(deps.map((d) => [d.group, d.name])).toEqual([
      ["implementation", "org.slf4j:slf4j-api"],
      ["api", "org.apache.commons:commons-lang3"],
      ["implementation", "org.springframework.boot:spring-boot-dependencies"],
      ["testImplementation", "com.fasterxml.jackson.core:jackson-databind"],
      ["catalog:jackson.databind", "libs.jackson.databind"],
    ]);
  });

  it("parses CRLF line endings exactly like LF, with the same positions", () => {
    const crlf = parseGradleBuild(text.replace(/\r?\n/g, "\r\n"));
    expect(crlf.map((d) => [d.group, d.name, d.rawSpec])).toEqual(deps.map((d) => [d.group, d.name, d.rawSpec]));
    expect(crlf.length).toBe(5);
  });

  it("string, map and platform notation", () => {
    expect(find(deps, "org.slf4j:slf4j-api")).toMatchObject({ rawSpec: "1.7.30", lowerBound: "1.7.30", kind: "registry" });
    expect(textAt(text, find(deps, "org.slf4j:slf4j-api").specRange!)).toBe("1.7.30");
    expect(textAt(text, find(deps, "org.slf4j:slf4j-api").nameRange)).toBe("org.slf4j:slf4j-api");
    const map = find(deps, "org.apache.commons:commons-lang3");
    expect(map).toMatchObject({ rawSpec: "3.12.0", kind: "registry" });
    expect(textAt(text, map.specRange!)).toBe("3.12.0");
    expect(find(deps, "org.springframework.boot:spring-boot-dependencies")).toMatchObject({ rawSpec: "2.5.0", kind: "registry" });
  });

  it("resolves $var versions with a specLocation on the definition", () => {
    const d = find(deps, "com.fasterxml.jackson.core:jackson-databind");
    expect(d).toMatchObject({ rawSpec: "2.9.8", lowerBound: "2.9.8", kind: "registry" });
    expect(textAt(text, d.specLocation!.range)).toBe("2.9.8");
    expect(d.specLocation!.rawSpec).toBe("2.9.8");
  });

  it("catalog accessors are unresolved", () => {
    expect(find(deps, "libs.jackson.databind").kind).toBe("unresolved");
  });
});

describe("parseGradleBuild edge cases", () => {
  it("leaves undefined variables unresolved and dynamic versions without a lower bound", () => {
    const deps = parseGradleBuild(`dependencies {
  implementation "g:a:\${missing}"
  implementation "g:b:1.+"
  implementation "g:c:[1.0,2.0)"
  implementation "g:d"
  implementation files('x.jar')
}`);
    expect(deps[0]).toMatchObject({ name: "g:a", kind: "unresolved" });
    expect(deps[0]!.rawSpec).toBeUndefined();
    expect(deps[1]).toMatchObject({ name: "g:b", rawSpec: "1.+", lowerBound: undefined, kind: "unresolved" });
    expect(deps[2]).toMatchObject({ name: "g:c", lowerBound: "1.0", kind: "registry" });
    expect(deps[3]).toMatchObject({ name: "g:d", kind: "unresolved" });
    expect(deps).toHaveLength(4);
  });

  it("handles ext blocks, def, custom quoted configurations", () => {
    const deps = parseGradleBuild(`ext {
  v = '1.2.3'
}
def w = "4.5.6"
dependencies {
  "customConf"("g:a:$v")
  classpath 'g:b:$w'
  kapt("g:c:1.0")
}`);
    expect(deps.map((d) => [d.group, d.name, d.rawSpec])).toEqual([
      ["customConf", "g:a", "1.2.3"],
      ["classpath", "g:b", "4.5.6"],
      ["kapt", "g:c", "1.0"],
    ]);
  });
});

describe("parseVersionCatalog", () => {
  const text = read("libs.versions.toml");
  const deps = parseVersionCatalog(text);

  it("resolves version.ref with specLocation on the [versions] value", () => {
    const d = find(deps, "com.fasterxml.jackson.core:jackson-databind");
    expect(d).toMatchObject({ group: "catalog:jackson.databind", rawSpec: "2.9.8", lowerBound: "2.9.8", kind: "registry" });
    expect(textAt(text, d.specLocation!.range)).toBe("2.9.8");
    expect(text.slice(0, text.indexOf("jackson = "))).toContain("[versions]");
  });

  it("string, group/name and rich forms; plugins skipped", () => {
    expect(find(deps, "org.slf4j:slf4j-api")).toMatchObject({ group: "catalog:slf4j.api", rawSpec: "1.7.30" });
    expect(textAt(text, find(deps, "org.slf4j:slf4j-api").specRange!)).toBe("1.7.30");
    expect(find(deps, "org.apache.commons:commons-lang3")).toMatchObject({ rawSpec: "3.12.0", kind: "registry" });
    expect(find(deps, "org.example:rich")).toMatchObject({ rawSpec: "[1.0,2.0)", lowerBound: "1.0" });
    expect(find(deps, "org.example:inline")).toMatchObject({ rawSpec: "1.2.3" });
    expect(deps.some((d) => d.name.includes("kotlin"))).toBe(false);
  });
});

describe("resolveGradleCatalog", () => {
  it("resolves libs.jackson.databind from an ancestor gradle/libs.versions.toml", async () => {
    const root = join(dir, "gradle-project");
    const manifestPath = join(root, "app", "build.gradle.kts");
    const parsed = parseGradleBuild(readFileSync(manifestPath, "utf8"));
    const [d] = await resolveGradleCatalog(parsed, { manifestPath, rootDir: root, files: nodeFileSource });
    expect(d).toMatchObject({
      name: "com.fasterxml.jackson.core:jackson-databind",
      rawSpec: "2.9.8",
      lowerBound: "2.9.8",
      kind: "registry",
    });
    expect(d!.specLocation!.path).toBe(join(root, "gradle", "libs.versions.toml"));
    expect(d!.specLocation!.rawSpec).toBe("2.9.8");
  });

  it("leaves deps untouched without a catalog", async () => {
    const manifestPath = join(dir, "build.gradle");
    const parsed = parseGradleBuild(read("build.gradle"));
    const out = await resolveGradleCatalog(parsed, { manifestPath, rootDir: dir, files: { read: async () => undefined, list: async () => [] } });
    expect(out.find((x) => x.group === "catalog:jackson.databind")!.kind).toBe("unresolved");
  });
});

describe("parseGradleLockfile", () => {
  const text = read("gradle.lockfile");
  const deps = parseGradleLockfile(text);
  it("parses entries and skips comments and empty=", () => {
    expect(deps.map((d) => [d.name, d.version, d.direct])).toEqual([
      ["com.fasterxml.jackson.core:jackson-databind", "2.9.8", false],
      ["org.slf4j:slf4j-api", "1.7.30", false],
    ]);
    expect(textAt(text, deps[0]!.range)).toBe("2.9.8");
  });
});
