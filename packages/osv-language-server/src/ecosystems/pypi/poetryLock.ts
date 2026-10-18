import type { ResolvedDep } from "../../core/types.js";
import { keyName } from "../../core/toml.js";
import { lockPackages, resolveUnrooted } from "./tomlLock.js";

/** Parses poetry.lock. Poetry does not record direct deps (the scanner reads them from the manifest). Throws ParseError on invalid TOML. */
export function parsePoetryLock(text: string): ResolvedDep[] {
  return resolveUnrooted(lockPackages(text, "package"), text, (p) =>
    (p.sub.get("dependencies")?.body ?? []).flatMap((kv) => keyName(kv) ?? []),
  );
}
