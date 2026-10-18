import { ParseError, type EcosystemModule } from "../types.js";
import { nugetComparator } from "../../versioning/nuget.js";
import { parseNugetLock } from "./lock.js";
import { parsePackagesConfig } from "./packagesConfig.js";
import { parsePackagesProps, parseProjectFile, resolveCentralVersions } from "./project.js";
import { rewriteNugetSpec } from "./range.js";

const LOCKFILE = "packages.lock.json";
const PACKAGES_PROPS = "Directory.Packages.props";

export const nugetModule: EcosystemModule = {
  id: "nuget",
  osvEcosystem: "NuGet",
  manifests: ["*.csproj", "*.fsproj", "*.vbproj", PACKAGES_PROPS, "Directory.Build.props", "packages.config"],
  lockfiles: [LOCKFILE],
  lockfilesForManifest: (manifest) => (manifest.endsWith(".props") ? [] : [LOCKFILE]),
  manifestForLockfile: () => undefined,
  manifestsForLockfile: () => ["*.csproj", "*.fsproj", "*.vbproj"],
  versioning: nugetComparator,
  // osv.dev matches NuGet names case-sensitively, so the casing is kept; matching uses nameKey.
  normalizeName: (name) => name,
  nameKey: (name) => name.toLowerCase(),
  parseManifest(text, fileName) {
    if (fileName === "packages.config") return parsePackagesConfig(text);
    if (fileName === PACKAGES_PROPS) return parsePackagesProps(text);
    if (/\.(cs|fs|vb)proj$/.test(fileName) || fileName === "Directory.Build.props") return parseProjectFile(text);
    throw new ParseError(`Unsupported NuGet manifest: ${fileName}`);
  },
  parseLockfile(text, fileName) {
    if (fileName === LOCKFILE) return parseNugetLock(text);
    throw new ParseError(`Unsupported NuGet lockfile: ${fileName}`);
  },
  rewriteSpec: rewriteNugetSpec,
  lockCommand: (ctx) => (ctx.lockfilePath !== undefined ? "dotnet restore --force-evaluate" : "dotnet restore"),
  // Advice only: a transitive package is raised by referencing it directly.
  transitiveFix: () => undefined,
  resolveExternal: (deps, ctx) => resolveCentralVersions(deps, ctx),
  relatedFiles: [PACKAGES_PROPS, "Directory.Build.props"],
};
