import { dirname } from "node:path";
import { rubygemsComparator } from "../../versioning/rubygems.js";
import type { EcosystemModule } from "../types.js";
import { parseGemfile } from "./gemfile.js";
import { parseGemfileLock } from "./gemfileLock.js";
import { parseGemspec } from "./gemspec.js";
import { rewriteGemRequirements } from "./requirement.js";

// Lock commands are sent to a terminal as text, so only shell-inert names are interpolated.
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const LITERAL = /(["'])((?:\\.|(?!\1).)*)\1/g;

export const rubygemsModule: EcosystemModule = {
  id: "rubygems",
  osvEcosystem: "RubyGems",
  manifests: ["Gemfile", "gems.rb", "*.gemspec"],
  lockfiles: ["Gemfile.lock", "gems.locked"],
  lockfilesForManifest: (manifest) => (manifest === "gems.rb" ? ["gems.locked"] : ["Gemfile.lock"]),
  manifestForLockfile: (lockfile) => (lockfile === "gems.locked" ? "gems.rb" : "Gemfile"),
  manifestsForLockfile: (lockfile) => [lockfile === "gems.locked" ? "gems.rb" : "Gemfile"],
  versioning: rubygemsComparator,
  normalizeName: (name) => name,
  parseManifest: (text, fileName) => (fileName.endsWith(".gemspec") ? parseGemspec(text) : parseGemfile(text)),
  parseLockfile: (text) => parseGemfileLock(text),
  rewriteSpec(rawSpec, target) {
    const literals = [...rawSpec.matchAll(LITERAL)];
    if (literals.length === 0) return { spec: rawSpec, widened: false };
    const quote = literals[0]![1]!;
    const { reqs, widened } = rewriteGemRequirements(literals.map((m) => m[2]!), target);
    return { spec: reqs.map((r) => `${quote}${r}${quote}`).join(", "), widened };
  },
  lockCommand: () => "bundle install",
  transitiveFix(ctx) {
    if (!SAFE_NAME.test(ctx.name)) return undefined;
    return {
      kind: "command-only",
      edit: [],
      lockCommand: { cwd: dirname(ctx.lockfilePath), command: `bundle update --conservative ${ctx.name}` },
    };
  },
};
