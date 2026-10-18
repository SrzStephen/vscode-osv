import { basename, dirname } from "node:path";
import { LineIndex } from "../../core/lineIndex.js";
import { ParseError, type EcosystemModule } from "../types.js";
import { mavenComparator } from "../../versioning/maven.js";
import { parseVersionCatalog, resolveGradleCatalog } from "./catalog.js";
import { parseGradleBuild } from "./gradle.js";
import { parseGradleLockfile } from "./gradleLock.js";
import { parsePom, resolvePomParent } from "./pom.js";
import { rewriteMavenSpec } from "./range.js";

const GRADLE_LOCKFILE = "gradle.lockfile";
// Edits are source text in a Gradle build file, so only quote-inert coordinates and versions are interpolated.
const SAFE_NAME = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;
const SAFE_VERSION = /^[A-Za-z0-9_.+-]+$/;

const gradleLockCommand = (): string =>
  process.platform === "win32" ? "./gradlew.bat dependencies --write-locks" : "./gradlew dependencies --write-locks";

export const mavenModule: EcosystemModule = {
  id: "maven",
  osvEcosystem: "Maven",
  manifests: ["pom.xml", "build.gradle", "build.gradle.kts", "gradle/libs.versions.toml"],
  lockfiles: [GRADLE_LOCKFILE, "buildscript-gradle.lockfile"],
  // Maven has no lockfile.
  lockfilesForManifest: (manifest) => (manifest === "pom.xml" ? [] : [GRADLE_LOCKFILE]),
  manifestForLockfile: () => "build.gradle.kts",
  manifestsForLockfile: () => ["build.gradle.kts", "build.gradle"],
  versioning: mavenComparator,
  normalizeName: (name) => name,
  parseManifest(text, fileName) {
    switch (fileName) {
      case "pom.xml":
        return parsePom(text);
      case "build.gradle":
      case "build.gradle.kts":
        return parseGradleBuild(text);
      case "libs.versions.toml":
        return parseVersionCatalog(text);
      default:
        throw new ParseError(`Unsupported Maven manifest: ${fileName}`);
    }
  },
  parseLockfile(text, fileName) {
    if (fileName === GRADLE_LOCKFILE || fileName === "buildscript-gradle.lockfile") return parseGradleLockfile(text);
    throw new ParseError(`Unsupported Maven lockfile: ${fileName}`);
  },
  rewriteSpec: rewriteMavenSpec,
  lockCommand: (ctx) =>
    ctx.lockfilePath !== undefined && basename(ctx.lockfilePath) === GRADLE_LOCKFILE ? gradleLockCommand() : undefined,
  transitiveFix(ctx) {
    // Only gradle.lockfile findings reach here; a pom.xml has no lockfile, so no <dependencyManagement> override is built.
    if (basename(ctx.lockfilePath) !== GRADLE_LOCKFILE) return undefined;
    if (ctx.manifestText === undefined || ctx.manifestUri === undefined) return undefined;
    if (!SAFE_NAME.test(ctx.name) || !SAFE_VERSION.test(ctx.target)) return undefined;
    const text = ctx.manifestText;
    const end = new LineIndex(text).position(text.length);
    const block = `dependencies {\n    constraints {\n        implementation("${ctx.name}:${ctx.target}")\n    }\n}\n`;
    return {
      kind: "override",
      edit: [{ uri: ctx.manifestUri, range: { start: end, end }, newText: `${text === "" || text.endsWith("\n") ? "\n" : "\n\n"}${block}` }],
      lockCommand: { cwd: dirname(ctx.lockfilePath), command: gradleLockCommand() },
    };
  },
  // The pom parse state is keyed by object identity, so the scanner's parsePom output must reach resolvePomParent as is.
  async resolveExternal(deps, ctx) {
    const name = basename(ctx.manifestPath);
    if (name === "pom.xml") return resolvePomParent(deps, ctx);
    if (name === "build.gradle" || name === "build.gradle.kts") return resolveGradleCatalog(deps, ctx);
    return deps;
  },
  relatedFiles: ["pom.xml", "gradle/libs.versions.toml"],
};
