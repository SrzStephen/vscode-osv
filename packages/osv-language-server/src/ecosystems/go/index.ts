import { ParseError, type EcosystemModule } from "../types.js";
import { goComparator, parseGoMod } from "./gomod.js";

// Lock commands are sent to a terminal as text, so only shell-inert module paths and versions are interpolated.
const SAFE_NAME = /^[A-Za-z0-9._~/-]+$/;
const SAFE_VERSION = /^[A-Za-z0-9.+-]+$/;

const bare = (v: string): string => v.replace(/^v/, "");

export const goModule: EcosystemModule = {
  id: "go",
  osvEcosystem: "Go",
  manifests: ["go.mod"],
  // go.mod is both manifest and lockfile (go.sum holds only hashes).
  lockfiles: [],
  lockfilesForManifest: () => [],
  manifestForLockfile: () => undefined,
  versioning: goComparator,
  normalizeName: (name) => name,
  manifestIsExact: true,
  parseManifest: (text) => parseGoMod(text),
  parseLockfile() {
    throw new ParseError("Go has no lockfile");
  },
  rewriteSpec: (_raw, target) => ({ spec: `v${bare(target)}`, widened: false }),
  lockCommand(ctx) {
    const target = bare(ctx.target);
    if (!SAFE_NAME.test(ctx.name) || !SAFE_VERSION.test(target)) return undefined;
    return `go get ${ctx.name}@v${target} && go mod tidy`;
  },
  // Indirect dependencies are listed in go.mod and edited directly as manifest findings.
  transitiveFix: () => undefined,
};
