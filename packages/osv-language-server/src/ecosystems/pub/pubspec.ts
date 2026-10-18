import semver from "semver";
import { isMap, isScalar, parseDocument, Scalar } from "yaml";
import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep, DepKind, TextRange } from "../../core/types.js";
import { ParseError } from "../types.js";

export const PUBSPEC_GROUPS = ["dependencies", "dev_dependencies", "dependency_overrides"];

/** Lowest version a Pub constraint admits; undefined for `any` and constraints with no usable floor. */
function lowerBound(spec: string): string | undefined {
  const s = spec.trim();
  if (s === "" || s === "any") return undefined;
  try {
    const min = semver.minVersion(s, { loose: true })?.version;
    // "<2.0.0" has no meaningful floor, so 0.0.0 only counts when it was written.
    return min === "0.0.0" && s !== "0.0.0" ? undefined : min;
  } catch {
    return undefined;
  }
}

/** Parses pubspec.yaml dependency groups. `sdk:` dependencies are skipped. Throws ParseError on invalid YAML. */
export function parsePubspec(text: string): DeclaredDep[] {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new ParseError("Invalid pubspec.yaml");
  const root = doc.contents;
  if (!isMap(root)) return [];
  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];

  // The range covers the scalar's content, without any quotes.
  const inner = (node: Scalar): TextRange | undefined => {
    if (!node.range) return undefined;
    const [start, end] = node.range;
    const quoted = node.type === Scalar.QUOTE_DOUBLE || node.type === Scalar.QUOTE_SINGLE;
    return quoted ? ix.range(start + 1, end - 1) : ix.range(start, end);
  };

  for (const group of PUBSPEC_GROUPS) {
    const section = root.get(group, true);
    if (!isMap(section)) continue;
    for (const pair of section.items) {
      if (!isScalar(pair.key) || !pair.key.range) continue;
      const [keyStart, keyEnd] = pair.key.range;
      const dep: DeclaredDep = { name: String(pair.key.value), nameRange: ix.range(keyStart, keyEnd), kind: "unresolved", group };
      let spec: Scalar | undefined;
      let kind: DepKind = "registry";

      if (isScalar(pair.value) && typeof pair.value.value === "string") spec = pair.value;
      else if (isMap(pair.value)) {
        if (pair.value.has("sdk")) continue;
        if (pair.value.has("git")) kind = "git";
        else if (pair.value.has("path")) kind = "path";
        else {
          const version = pair.value.get("version", true);
          if (isScalar(version) && typeof version.value === "string") spec = version;
        }
      }
      if (kind !== "registry") dep.kind = kind;
      else if (spec) {
        const range = inner(spec);
        const lb = lowerBound(spec.value as string);
        dep.rawSpec = spec.value as string;
        if (range) dep.specRange = range;
        if (lb !== undefined) {
          dep.lowerBound = lb;
          dep.kind = "registry";
        }
      }
      deps.push(dep);
    }
  }
  return deps;
}
