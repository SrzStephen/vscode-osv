import type { ResolvedDep } from "../../core/types.js";
import { resolveEntries } from "../npm/lockCommon.js";
import { lockPackages, versionedEntries } from "./tomlLock.js";

/** Parses pdm.lock. PDM does not record direct deps (the scanner reads them from the manifest). Throws ParseError on invalid TOML. */
export function parsePdmLock(text: string): ResolvedDep[] {
  return resolveEntries(versionedEntries(lockPackages(text, "package"), text), []);
}
