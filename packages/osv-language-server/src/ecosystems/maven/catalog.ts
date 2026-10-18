import { dirname, join } from "node:path";
import { LineIndex } from "../../core/lineIndex.js";
import type { FileSource } from "../../core/fileSource.js";
import type { DeclaredDep, TextRange } from "../../core/types.js";
import {
  isString, parseTomlAst, plainContentRange, stringContentRange, tablesByKey,
  type TOMLContentNode, type TOMLKeyValue, type TOMLStringValue,
} from "../../core/toml.js";
import { ParseError } from "../types.js";
import { gradleLowerBound } from "./gradle.js";

const CATALOG_PREFIX = "catalog:";
const RICH_KEYS = ["strictly", "require", "prefer"];

const keyText = (k: TOMLKeyValue["key"]["keys"][number]) => (k.type === "TOMLBare" ? k.name : k.value);

/** Properties of an entry keyed by their dotted path below the entry's own key (`version.ref`, `module`). */
interface Props {
  keyRange: [number, number];
  values: Map<string, TOMLContentNode>;
  /** Value of a plain `alias = "g:a:v"` entry. */
  shorthand?: TOMLStringValue;
}

function addTable(values: Map<string, TOMLContentNode>, prefix: string, body: TOMLKeyValue[]): void {
  for (const kv of body) {
    const path = [prefix, ...kv.key.keys.map(keyText)].filter(Boolean).join(".");
    if (kv.value.type === "TOMLInlineTable") addTable(values, path, kv.value.body);
    else values.set(path, kv.value);
  }
}

function entriesOf(body: TOMLKeyValue[]): Map<string, Props> {
  const out = new Map<string, Props>();
  for (const kv of body) {
    const [first, ...rest] = kv.key.keys;
    if (!first) continue;
    const key = keyText(first);
    let entry = out.get(key);
    if (!entry) {
      entry = { keyRange: first.type === "TOMLQuoted" ? stringContentRange(first) : first.range, values: new Map() };
      out.set(key, entry);
    }
    if (rest.length > 0) {
      const path = rest.map(keyText).join(".");
      if (kv.value.type === "TOMLInlineTable") addTable(entry.values, path, kv.value.body);
      else entry.values.set(path, kv.value);
    } else if (isString(kv.value)) {
      entry.shorthand = kv.value;
    } else if (kv.value.type === "TOMLInlineTable") {
      addTable(entry.values, "", kv.value.body);
    }
  }
  return out;
}

/** `-`, `_` and `.` are interchangeable in catalog aliases. */
export const normalizeAlias = (alias: string) => alias.replace(/[-_]/g, ".");

interface Located {
  value: string;
  range: [number, number];
}

function located(text: string, node: TOMLContentNode | undefined): Located | undefined {
  if (!isString(node)) return undefined;
  const range = plainContentRange(text, node);
  return range && { value: node.value, range };
}

/** First of `strictly`, `require`, `prefer` present under `prefix` (or the plain string at `prefix`). */
function richVersion(text: string, values: Map<string, TOMLContentNode>, prefix: string): Located | undefined {
  const plain = prefix ? located(text, values.get(prefix)) : undefined;
  if (plain) return plain;
  for (const k of RICH_KEYS) {
    const hit = located(text, values.get(prefix ? `${prefix}.${k}` : k));
    if (hit) return hit;
  }
  return undefined;
}

/** Libraries of a gradle/libs.versions.toml; `[plugins]` and `[bundles]` are skipped. Throws ParseError on invalid TOML. */
export function parseVersionCatalog(text: string): DeclaredDep[] {
  const tables = tablesByKey(parseTomlAst(text));
  const ix = new LineIndex(text);
  const range = ([a, b]: [number, number]): TextRange => ix.range(a, b);

  const versions = new Map<string, Located>();
  for (const [name, e] of entriesOf((tables.get("versions") ?? []).flatMap((t) => t.body))) {
    const v = e.shorthand ? located(text, e.shorthand) : richVersion(text, e.values, "");
    if (v) versions.set(name, v);
  }

  const deps: DeclaredDep[] = [];
  for (const [alias, e] of entriesOf((tables.get("libraries") ?? []).flatMap((t) => t.body))) {
    const group = `${CATALOG_PREFIX}${normalizeAlias(alias)}`;
    let module: Located | undefined;
    let version: Located | undefined;
    let ref: string | undefined;
    if (e.shorthand) {
      const s = located(text, e.shorthand);
      if (!s) continue;
      const parts = s.value.split(":");
      if (parts.length < 2) continue;
      const nameLen = parts[0]!.length + 1 + parts[1]!.length;
      module = { value: `${parts[0]}:${parts[1]}`, range: [s.range[0], s.range[0] + nameLen] };
      if (parts[2]) version = { value: parts[2], range: [s.range[0] + nameLen + 1, s.range[0] + nameLen + 1 + parts[2].length] };
    } else {
      const m = located(text, e.values.get("module"));
      const g = located(text, e.values.get("group"));
      const n = located(text, e.values.get("name"));
      if (m) module = m;
      else if (g && n) module = { value: `${g.value}:${n.value}`, range: n.range };
      if (!module) continue;
      const r = e.values.get("version.ref");
      const refText = isString(r) ? r.value : undefined;
      if (refText !== undefined) ref = refText;
      else version = richVersion(text, e.values, "version");
    }

    const base = { name: module.value, group, nameRange: range(module.range) };
    let rawSpec: string | undefined;
    let specRange: TextRange | undefined;
    let specLocation: DeclaredDep["specLocation"];
    if (ref !== undefined) {
      const v = versions.get(ref);
      const refNode = e.values.get("version.ref") as TOMLStringValue;
      specRange = range(stringContentRange(refNode));
      if (v) {
        rawSpec = v.value;
        specLocation = { path: "", range: range(v.range), rawSpec };
      }
    } else if (version) {
      rawSpec = version.value;
      specRange = range(version.range);
    }
    const lowerBound = rawSpec === undefined ? undefined : gradleLowerBound(rawSpec);
    deps.push({
      ...base,
      rawSpec,
      specRange,
      ...(specLocation ? { specLocation } : {}),
      lowerBound,
      kind: lowerBound === undefined ? "unresolved" : "registry",
    });
  }
  return deps;
}

/**
 * Fills `libs.*` accessor dependencies of a build script from the nearest `gradle/libs.versions.toml`
 * in the build file's directory or an ancestor up to `rootDir`.
 */
export async function resolveGradleCatalog(
  deps: DeclaredDep[],
  ctx: { manifestPath: string; rootDir: string; files: FileSource },
): Promise<DeclaredDep[]> {
  if (!deps.some((d) => d.group?.startsWith(CATALOG_PREFIX))) return deps;

  let catalog: { path: string; deps: DeclaredDep[] } | undefined;
  for (let dir = dirname(ctx.manifestPath); ; dir = dirname(dir)) {
    const path = join(dir, "gradle", "libs.versions.toml");
    const text = await ctx.files.read(path);
    if (text !== undefined) {
      try {
        catalog = { path, deps: parseVersionCatalog(text) };
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
      }
      break;
    }
    if (dir === ctx.rootDir || dirname(dir) === dir) break;
  }
  if (!catalog) return deps;

  return deps.map((dep) => {
    if (!dep.group?.startsWith(CATALOG_PREFIX) || dep.rawSpec !== undefined) return dep;
    const hit = catalog!.deps.find((c) => c.group === dep.group);
    if (!hit) return dep;
    const loc = hit.specLocation?.range ?? hit.specRange;
    return {
      ...dep,
      name: hit.name,
      rawSpec: hit.rawSpec,
      lowerBound: hit.lowerBound,
      kind: hit.kind,
      ...(hit.rawSpec !== undefined && loc ? { specLocation: { path: catalog!.path, range: loc, rawSpec: hit.rawSpec } } : {}),
    };
  });
}
