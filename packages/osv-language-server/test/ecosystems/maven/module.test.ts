import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IgnoreMatcher } from "../../../src/core/ignores.js";
import { LineIndex } from "../../../src/core/lineIndex.js";
import { scanDocument, type ScanContext } from "../../../src/core/scanner.js";
import { DEFAULT_SETTINGS } from "../../../src/core/settings.js";
import type { OsvRecord, PackageQuery, TextRange } from "../../../src/core/types.js";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { mavenModule } from "../../../src/ecosystems/maven/index.js";

const fixtures = join(__dirname, "..", "..", "fixtures");
const read = (...p: string[]): string => readFileSync(join(fixtures, ...p), "utf8");
const LOG4J_IDS = ["GHSA-jfh8-c2jp-5v3q", "GHSA-7rjr-3q55-vv33", "GHSA-p6xc-xr62-6r2g", "GHSA-8489-44mv-ggj8"];
const log4jRecords = (): OsvRecord[] => LOG4J_IDS.map((id) => JSON.parse(read("osv", `${id}.json`)) as OsvRecord);

function ctx(files: Record<string, string>): ScanContext {
  return {
    files: { read: async (p) => files[p], list: async () => [] },
    osv: {
      lookup: async (queries: PackageQuery[]) => {
        const results = new Map<string, { records: OsvRecord[]; cached: boolean }>();
        for (const q of queries) {
          results.set(`${q.ecosystem}|${q.name}|${q.version}`, {
            records: q.name === "org.apache.logging.log4j:log4j-core" ? log4jRecords() : [],
            cached: false,
          });
        }
        return { results, offline: false, skipped: [] };
      },
    },
    settings: { ...DEFAULT_SETTINGS },
    ignores: new IgnoreMatcher([], [], new Date()),
    rootDir: "/ws",
  };
}

const apply = (text: string, edit: { range: TextRange; newText: string }): string => {
  const ix = new LineIndex(text);
  return text.slice(0, ix.offset(edit.range.start)) + edit.newText + text.slice(ix.offset(edit.range.end));
};

const filesOf = (files: Record<string, string>) => ({ read: async (p: string) => files[p], list: async () => [] });

describe("mavenModule", () => {
  it("is registered and classifies all four manifests and both lockfiles", () => {
    expect(ALL_MODULES).toContain(mavenModule);
    for (const p of ["pom.xml", "svc/pom.xml", "build.gradle", "build.gradle.kts", "app/build.gradle.kts", "gradle/libs.versions.toml", "x/gradle/libs.versions.toml"]) {
      expect(classifyFile(p)).toMatchObject({ role: "manifest" });
      expect(classifyFile(p)?.module.id).toBe("maven");
    }
    for (const p of ["gradle.lockfile", "app/gradle.lockfile", "buildscript-gradle.lockfile"]) {
      expect(classifyFile(p)).toMatchObject({ role: "lockfile" });
      expect(classifyFile(p)?.module.id).toBe("maven");
    }
  });

  it("declares ids, lockfile mapping and the comparator", () => {
    expect(mavenModule).toMatchObject({ id: "maven", osvEcosystem: "Maven" });
    expect(mavenModule.manifests).toEqual(["pom.xml", "build.gradle", "build.gradle.kts", "gradle/libs.versions.toml"]);
    expect(mavenModule.lockfiles).toEqual(["gradle.lockfile", "buildscript-gradle.lockfile"]);
    expect(mavenModule.lockfilesForManifest("pom.xml")).toEqual([]);
    for (const m of ["build.gradle", "build.gradle.kts", "libs.versions.toml"]) expect(mavenModule.lockfilesForManifest(m)).toEqual(["gradle.lockfile"]);
    expect(mavenModule.manifestForLockfile("gradle.lockfile")).toBe("build.gradle.kts");
    expect(mavenModule.manifestsForLockfile?.("gradle.lockfile")).toEqual(["build.gradle.kts", "build.gradle"]);
    expect(mavenModule.relatedFiles).toEqual(["pom.xml", "gradle/libs.versions.toml"]);
    expect(mavenModule.normalizeName("Org.Foo:Bar")).toBe("Org.Foo:Bar");
    expect(mavenModule.versioning.compare("2.10", "2.9")).toBeGreaterThan(0);
  });

  it("lockCommand is gradlew with a gradle.lockfile and undefined for Maven", () => {
    const cmd = process.platform === "win32" ? "./gradlew.bat dependencies --write-locks" : "./gradlew dependencies --write-locks";
    const base = { manifestPath: "/ws/build.gradle.kts", name: "g:a", target: "1.0" };
    expect(mavenModule.lockCommand({ ...base, lockfilePath: "/ws/gradle.lockfile" })).toBe(cmd);
    expect(mavenModule.lockCommand(base)).toBeUndefined();
    expect(mavenModule.lockCommand({ manifestPath: "/ws/pom.xml", name: "g:a", target: "1.0" })).toBeUndefined();
  });

  describe("transitiveFix", () => {
    const ctxFor = (manifestText: string) => ({
      name: "org.yaml:snakeyaml",
      current: "1.26",
      target: "1.33",
      lockfilePath: "/ws/gradle.lockfile",
      manifestPath: "/ws/build.gradle.kts",
      manifestUri: "file:///ws/build.gradle.kts",
      manifestText,
    });

    it("appends one constraints block at the end of the build file", () => {
      const text = 'plugins { java }\ndependencies {\n    implementation("a:b:1")\n}\n';
      const plan = mavenModule.transitiveFix(ctxFor(text))!;
      expect(plan).toMatchObject({ kind: "override", lockCommand: { cwd: "/ws" } });
      expect(plan.edit).toHaveLength(1);
      expect(plan.edit[0]!.uri).toBe("file:///ws/build.gradle.kts");
      const out = apply(text, plan.edit[0]!);
      expect(out).toBe(`${text}\ndependencies {\n    constraints {\n        implementation("org.yaml:snakeyaml:1.33")\n    }\n}\n`);
      expect(out.split("constraints {").length - 1).toBe(1);
    });

    it("handles a file without a trailing newline", () => {
      const text = "plugins { java }";
      const out = apply(text, mavenModule.transitiveFix(ctxFor(text))!.edit[0]!);
      expect(out).toBe(`${text}\n\ndependencies {\n    constraints {\n        implementation("org.yaml:snakeyaml:1.33")\n    }\n}\n`);
    });

    it("is unavailable without the manifest text, off gradle.lockfile, or for unsafe values", () => {
      expect(mavenModule.transitiveFix({ ...ctxFor("x\n"), manifestText: undefined })).toBeUndefined();
      expect(mavenModule.transitiveFix({ ...ctxFor("x\n"), lockfilePath: "/ws/buildscript-gradle.lockfile" })).toBeUndefined();
      expect(mavenModule.transitiveFix({ ...ctxFor("x\n"), target: '1"; evil("' })).toBeUndefined();
    });
  });

  describe("scanDocument", () => {
    it("pom.xml log4j-core 2.14.1 is fixed by 2.17.1", async () => {
      const pom = read("maven", "pom.xml");
      const r = await scanDocument("file:///ws/pom.xml", "/ws/pom.xml", pom, ctx({ "/ws/pom.xml": pom }));
      const f = r.findings.find((x) => x.name === "org.apache.logging.log4j:log4j-core")!;
      expect(f).toMatchObject({ current: "2.14.1", checkedLowerBound: true, fix: { target: "2.17.1" }, update: { kind: "direct" } });
      expect(f.update!.lockCommand).toBeUndefined();
    });

    it("backport: log4j-core 2.12.1 is fixed by 2.12.4", async () => {
      const pom = read("maven", "pom.xml").replace("<version>2.14.1</version>", "<version>2.12.1</version>");
      const r = await scanDocument("file:///ws/pom.xml", "/ws/pom.xml", pom, ctx({}));
      const f = r.findings.find((x) => x.name === "org.apache.logging.log4j:log4j-core")!;
      expect(f).toMatchObject({ current: "2.12.1", fix: { target: "2.12.4" } });
    });

    it("scanner resolves parent POM properties and management (parsePom output reaches resolvePomParent unchanged)", async () => {
      const files = {
        "/ws/parent-chain/pom.xml": read("maven", "parent-chain", "pom.xml"),
        "/ws/parent-chain/child/pom.xml": read("maven", "parent-chain", "child", "pom.xml"),
      };
      const text = files["/ws/parent-chain/child/pom.xml"];
      const deps = await mavenModule.resolveExternal!(mavenModule.parseManifest(text, "pom.xml"), {
        manifestPath: "/ws/parent-chain/child/pom.xml",
        rootDir: "/ws",
        files: filesOf(files),
      });
      expect(deps.find((d) => d.name === "com.google.guava:guava")).toMatchObject({ lowerBound: "31.0-jre" });
      expect(deps.find((d) => d.name === "org.yaml:snakeyaml")).toMatchObject({ lowerBound: "1.26" });
    });

    it("end to end through scanDocument, a child pom gets versions from the parent", async () => {
      const files = {
        "/ws/parent-chain/pom.xml": read("maven", "parent-chain", "pom.xml"),
        "/ws/parent-chain/child/pom.xml": read("maven", "parent-chain", "child", "pom.xml"),
      };
      const seen: PackageQuery[] = [];
      const c = ctx(files);
      const lookup = c.osv.lookup;
      c.osv = { lookup: async (q: PackageQuery[]) => (seen.push(...q), lookup(q)) };
      await scanDocument("file:///ws/parent-chain/child/pom.xml", "/ws/parent-chain/child/pom.xml", files["/ws/parent-chain/child/pom.xml"], c);
      expect(seen).toContainEqual({ ecosystem: "Maven", name: "com.google.guava:guava", version: "31.0-jre" });
      expect(seen).toContainEqual({ ecosystem: "Maven", name: "org.yaml:snakeyaml", version: "1.26" });
    });

    it("gradle build script resolves libs.* through the version catalog", async () => {
      const files = {
        "/ws/gradle/libs.versions.toml": read("maven", "libs.versions.toml"),
        "/ws/build.gradle.kts": read("maven", "build.gradle.kts"),
      };
      const deps = await mavenModule.resolveExternal!(mavenModule.parseManifest(files["/ws/build.gradle.kts"], "build.gradle.kts"), {
        manifestPath: "/ws/build.gradle.kts",
        rootDir: "/ws",
        files: filesOf(files),
      });
      expect(deps.find((d) => d.name === "com.fasterxml.jackson.core:jackson-databind" && d.specLocation?.path.endsWith("libs.versions.toml"))).toBeDefined();
    });

    it("parses gradle.lockfile and buildscript-gradle.lockfile", () => {
      const deps = mavenModule.parseLockfile(read("maven", "gradle.lockfile"), "gradle.lockfile");
      expect(deps.map((d) => `${d.name}@${d.version}`)).toEqual([
        "com.fasterxml.jackson.core:jackson-databind@2.9.8",
        "org.slf4j:slf4j-api@1.7.30",
      ]);
      expect(mavenModule.parseLockfile(read("maven", "gradle.lockfile"), "buildscript-gradle.lockfile")).toHaveLength(2);
    });
  });
});
