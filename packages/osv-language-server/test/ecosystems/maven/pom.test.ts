import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeclaredDep } from "../../../src/core/types.js";
import type { FileSource } from "../../../src/core/fileSource.js";
import { nodeFileSource } from "../../../src/core/fileSource.js";
import { parsePom, resolvePomParent } from "../../../src/ecosystems/maven/pom.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { textAt } from "../../helpers/textAt.js";

const dir = join(__dirname, "..", "..", "fixtures", "maven");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const find = (deps: DeclaredDep[], name: string, group?: string) =>
  deps.find((d) => d.name === name && (group === undefined || d.group === group))!;
const ctx = { manifestPath: "", rootDir: dir, files: nodeFileSource };
const resolve = (rel: string) => {
  const manifestPath = join(dir, rel);
  return resolvePomParent(parsePom(readFileSync(manifestPath, "utf8")), { ...ctx, manifestPath });
};

describe("parsePom", () => {
  const text = read("pom.xml");
  const deps = parsePom(text);

  it("literal, property, and dependencyManagement versions", () => {
    expect(find(deps, "org.apache.logging.log4j:log4j-core")).toMatchObject({ rawSpec: "2.14.1", lowerBound: "2.14.1", kind: "registry", group: "dependencies" });
    const p = find(deps, "com.fasterxml.jackson.core:jackson-databind");
    expect(textAt(text, p.specLocation!.range)).toBe("2.9.8");
    expect(p.specLocation!.rawSpec).toBe("2.9.8");
    expect(textAt(text, p.specRange!)).toBe("${jackson.version}");
    expect(p).toMatchObject({ rawSpec: "2.9.8", lowerBound: "2.9.8", kind: "registry" });
    expect(find(deps, "org.slf4j:slf4j-api", "dependencyManagement")).toMatchObject({ rawSpec: "1.7.30" });
  });
  it("inline literal specRange covers the version text and name range the artifactId", () => {
    const d = find(deps, "org.apache.logging.log4j:log4j-core");
    expect(textAt(text, d.specRange!)).toBe("2.14.1");
    expect(d.specLocation).toBeUndefined();
    expect(textAt(text, d.nameRange)).toBe("log4j-core");
  });
  it("chases property aliases and project.version", () => {
    const a = find(deps, "com.fasterxml.jackson.core:jackson-core");
    expect(textAt(text, a.specLocation!.range)).toBe("2.9.8");
    const s = find(deps, "com.example:self");
    expect(s.rawSpec).toBe("1.5.0");
    expect(textAt(text, s.specLocation!.range)).toBe("1.5.0");
  });
  it("plugins, profiles, ranges; skips import/system scopes", () => {
    expect(find(deps, "org.apache.maven.plugins:maven-compiler-plugin")).toMatchObject({ group: "plugins", rawSpec: "3.8.1" });
    expect(find(deps, "commons-io:commons-io")).toMatchObject({ group: "profile:extra", rawSpec: "[2.0,2.7)", lowerBound: "2.0" });
    expect(deps.find((d) => d.name === "com.example:bom")).toBeUndefined();
    expect(deps.find((d) => d.name === "sun:tools")).toBeUndefined();
  });
  it("missing version is unresolved", () => {
    const d = find(deps, "org.slf4j:slf4j-api", "dependencies");
    expect(d.kind).toBe("unresolved");
    expect(d.rawSpec).toBeUndefined();
  });
  it("undefined property → unresolved, no throw", () => expect(find(parsePom(read("pom-missing-prop.xml")), "a:b").kind).toBe("unresolved"));
  it("throws ParseError on invalid XML", () => expect(() => parsePom("<project>")).toThrow(ParseError));
});

describe("resolvePomParent", () => {
  it("fills a missing version from the same file's dependencyManagement", async () => {
    const manifestPath = join(dir, "pom.xml");
    const out = await resolvePomParent(parsePom(read("pom.xml")), { ...ctx, manifestPath });
    const d = find(out, "org.slf4j:slf4j-api", "dependencies");
    expect(d).toMatchObject({ rawSpec: "1.7.30", lowerBound: "1.7.30", kind: "registry" });
    expect(textAt(read("pom.xml"), d.specLocation!.range)).toBe("1.7.30");
    expect(d.specLocation!.path).toBe(manifestPath);
  });
  it("parent dependencyManagement fills a missing version", async () => {
    const out = await resolve("parent-chain/child/pom.xml");
    const d = find(out, "org.yaml:snakeyaml");
    expect(d).toMatchObject({ rawSpec: "1.26", lowerBound: "1.26", kind: "registry" });
    expect(d.specLocation!.path).toBe(join(dir, "parent-chain", "pom.xml"));
    expect(textAt(read("parent-chain/pom.xml"), d.specLocation!.range)).toBe("1.26");
  });
  it("parent properties resolve ${prop}", async () => {
    const d = find(await resolve("parent-chain/child/pom.xml"), "com.google.guava:guava");
    expect(d).toMatchObject({ rawSpec: "31.0-jre", kind: "registry" });
    expect(textAt(read("parent-chain/pom.xml"), d.specLocation!.range)).toBe("31.0-jre");
  });
  it("walks several levels", async () => {
    const d = find(await resolve("parent-chain/sub/leaf/pom.xml"), "com.google.guava:guava");
    expect(d.specLocation!.path).toBe(join(dir, "parent-chain", "pom.xml"));
  });
  it("leaves unknown properties unresolved", async () => {
    expect(find(await resolve("parent-chain/child/pom.xml"), "x:nowhere").kind).toBe("unresolved");
  });
  it("does not read parents outside rootDir or missing ones", async () => {
    const manifestPath = join(dir, "parent-chain", "child", "pom.xml");
    const out = await resolvePomParent(parsePom(read("parent-chain/child/pom.xml")), { manifestPath, rootDir: join(dir, "parent-chain", "child"), files: nodeFileSource });
    expect(find(out, "org.yaml:snakeyaml").kind).toBe("unresolved");
    const files: FileSource = { read: async (p) => (p === manifestPath ? read("parent-chain/child/pom.xml") : undefined), list: async () => [] };
    const out2 = await resolvePomParent(parsePom(read("parent-chain/child/pom.xml")), { manifestPath, rootDir: dir, files });
    expect(find(out2, "org.yaml:snakeyaml").kind).toBe("unresolved");
  });
});
