import { semverLooseComparator } from "../../versioning/semverLoose.js";
import type { EcosystemModule } from "../types.js";
import { parseWorkflow } from "./workflow.js";

/** Keeps the `v` prefix and the ref's precision when lossless: `v45` + 46.0.0 gives `v46`, + 46.0.1 gives `v46.0.1`. */
function rewriteRef(raw: string, target: string): { spec: string; widened: boolean } {
  const prefix = raw.startsWith("v") ? "v" : "";
  const parts = raw.replace(/^v/, "").split(".").length;
  const t = target.replace(/^v/, "");
  const segments = t.split(".");
  const lossless = /^\d+(\.\d+){2}$/.test(t) && segments.slice(parts).every((s) => s === "0");
  return { spec: prefix + (lossless ? segments.slice(0, parts).join(".") : t), widened: false };
}

export const githubActionsModule: EcosystemModule = {
  id: "githubActions",
  osvEcosystem: "GitHub Actions",
  manifests: [".github/workflows/*.yml", ".github/workflows/*.yaml", "action.yml", "action.yaml"],
  lockfiles: [],
  lockfilesForManifest: () => [],
  manifestForLockfile: () => undefined,
  versioning: semverLooseComparator,
  normalizeName: (name) => name,
  nameKey: (name) => name.toLowerCase(),
  // The ref is the version; OSV does not match it, so records are filtered locally.
  manifestIsExact: true,
  clientSideMatching: true,
  parseManifest: (text) => parseWorkflow(text),
  parseLockfile: () => [],
  rewriteSpec: rewriteRef,
  lockCommand: () => undefined,
  transitiveFix: () => undefined,
};
