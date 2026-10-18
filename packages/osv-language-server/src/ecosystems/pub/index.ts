import { isMap, isScalar, parseDocument } from "yaml";
import { semverComparator } from "../../versioning/semver.js";
import { rewriteNpmSpec } from "../npm/rewrite.js";
import type { EcosystemModule } from "../types.js";
import { parsePubspec, PUBSPEC_GROUPS } from "./pubspec.js";
import { parsePubspecLock } from "./pubspecLock.js";

/** True when any dependency group declares a Flutter SDK dependency. */
function usesFlutter(manifestText: string | undefined): boolean {
  if (manifestText === undefined) return false;
  const root = parseDocument(manifestText).contents;
  if (!isMap(root)) return false;
  return PUBSPEC_GROUPS.some((group) => {
    const section = root.get(group);
    if (!isMap(section)) return false;
    return section.items.some((p) => {
      const sdk = isMap(p.value) ? p.value.get("sdk", true) : undefined;
      return isScalar(sdk) && String(sdk.value) === "flutter";
    });
  });
}

export const pubModule: EcosystemModule = {
  id: "pub",
  osvEcosystem: "Pub",
  manifests: ["pubspec.yaml"],
  lockfiles: ["pubspec.lock"],
  lockfilesForManifest: () => ["pubspec.lock"],
  manifestForLockfile: () => "pubspec.yaml",
  versioning: semverComparator,
  normalizeName: (name) => name,
  parseManifest: (text) => parsePubspec(text),
  parseLockfile: (text) => parsePubspecLock(text),
  // Pub's caret and range syntax is a subset of npm's.
  rewriteSpec: rewriteNpmSpec,
  lockCommand: (ctx) => (usesFlutter(ctx.manifestText) ? "flutter pub get" : "dart pub get"),
  transitiveFix: () => undefined,
};
