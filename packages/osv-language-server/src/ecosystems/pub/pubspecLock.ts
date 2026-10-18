import { isMap, isScalar, parseDocument } from "yaml";
import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { ParseError } from "../types.js";

/**
 * Parses pubspec.lock `packages`. SDK, path and git sources are not registry versions and are skipped.
 * An entry is direct when its `dependency` is `direct main`, `direct dev` or `direct overridden`.
 * Throws ParseError on invalid YAML.
 */
export function parsePubspecLock(text: string): ResolvedDep[] {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new ParseError("Invalid pubspec.lock");
  const root = doc.contents;
  if (!isMap(root)) throw new ParseError("Incomplete pubspec.lock");
  const packages = root.get("packages", true);
  if (!isMap(packages)) return [];
  const ix = new LineIndex(text);
  const deps: ResolvedDep[] = [];

  for (const pair of packages.items) {
    if (!isScalar(pair.key) || !isMap(pair.value)) continue;
    const source = pair.value.get("source");
    if (source === "sdk" || source === "path" || source === "git") continue;
    const version = pair.value.get("version", true);
    if (!isScalar(version) || !version.range) continue;
    // Pub quotes versions; the range excludes the quotes.
    const [start, end] = version.range;
    const quoted = text[start] === '"' || text[start] === "'";
    const dependency = pair.value.get("dependency");
    deps.push({
      name: String(pair.key.value),
      version: String(version.value),
      range: quoted ? ix.range(start + 1, end - 1) : ix.range(start, end),
      direct: typeof dependency === "string" && dependency.startsWith("direct"),
    });
  }
  return deps;
}
