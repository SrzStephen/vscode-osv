import { dirname, join } from "node:path";
import { LineIndex } from "../../core/lineIndex.js";
import { ParseError } from "../types.js";
import {
  isString, keyName, parseTomlAst, plainContentRange, stringContentRange,
  type TOMLContentNode, type TOMLKeyValue, type TOMLStringValue,
} from "../../core/toml.js";
import type { DeclaredDep, DepKind } from "../../core/types.js";
import type { FileSource } from "../../core/fileSource.js";
import { cargoLowerBound } from "./req.js";

const DEP_TABLES = ["dependencies", "dev-dependencies", "build-dependencies"];
const WORKSPACE_SUFFIX = ":workspace";

interface Entry {
  key: string;
  keyRange: [number, number];
  props: Map<string, TOMLContentNode>;
  /** Value of a plain `name = "1.0"` entry. */
  shorthand?: TOMLStringValue;
}

/** The table's group (`dependencies`, `target.<cfg>.dev-dependencies`, ...) and whether the key is a dependency table or one level below. */
function classify(resolved: string[]): { group: string; sub: boolean } | undefined {
  const isTable = (k: string[]) =>
    (k.length === 1 && DEP_TABLES.includes(k[0]!)) ||
    (k.length === 2 && k[0] === "workspace" && k[1] === "dependencies") ||
    (k.length === 3 && k[0] === "target" && DEP_TABLES.includes(k[2]!));
  if (isTable(resolved)) return { group: resolved.join("."), sub: false };
  const parent = resolved.slice(0, -1);
  if (resolved.length > 1 && isTable(parent)) return { group: parent.join("."), sub: true };
  return undefined;
}

function keyRangeOf(node: TOMLKeyValue["key"]["keys"][number]): [number, number] {
  return node.type === "TOMLQuoted" ? stringContentRange(node) : node.range;
}

function entriesOf(body: TOMLKeyValue[]): Entry[] {
  const entries = new Map<string, Entry>();
  for (const kv of body) {
    const [first, second] = kv.key.keys;
    if (!first) continue;
    const key = first.type === "TOMLBare" ? first.name : first.value;
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, keyRange: keyRangeOf(first), props: new Map() };
      entries.set(key, entry);
    }
    if (second) {
      // Dotted key: `foo.version = "1"`.
      const prop = keyName({ ...kv, key: { ...kv.key, keys: [second] } } as TOMLKeyValue);
      if (prop !== undefined) entry.props.set(prop, kv.value);
    } else if (isString(kv.value)) {
      entry.shorthand = kv.value;
    } else if (kv.value.type === "TOMLInlineTable") {
      for (const inner of kv.value.body) {
        const prop = keyName(inner);
        if (prop !== undefined) entry.props.set(prop, inner.value);
      }
    }
  }
  return [...entries.values()];
}

/** The table key each parsed dependency was declared under; differs from `name` when `package` renames it. */
const declaredKeys = new WeakMap<DeclaredDep, string>();

function toDep(entry: Entry, group: string, text: string, ix: LineIndex): DeclaredDep {
  const { props } = entry;
  const versionNode = entry.shorthand ?? props.get("version");
  const specNode = isString(versionNode) ? versionNode : undefined;
  const specRange = specNode && plainContentRange(text, specNode);
  const rawSpec = specRange && specNode!.value;
  const lowerBound = rawSpec === undefined ? undefined : cargoLowerBound(rawSpec);
  const pkg = props.get("package");
  const name = isString(pkg) ? pkg.value : entry.key;
  const ws = props.get("workspace");
  const inherited = ws?.type === "TOMLValue" && ws.kind === "boolean" && ws.value === true;
  const kind: DepKind = props.has("git") ? "git" : props.has("path") ? "path" : "registry";
  const dep: DeclaredDep = {
    name,
    rawSpec,
    nameRange: ix.range(...entry.keyRange),
    specRange: specRange && ix.range(...specRange),
    lowerBound,
    kind: inherited || (kind === "registry" && lowerBound === undefined) ? "unresolved" : kind,
    group: inherited ? `${group}${WORKSPACE_SUFFIX}` : group,
  };
  declaredKeys.set(dep, entry.key);
  return dep;
}

/** Dependencies from a Cargo.toml. Throws ParseError on invalid TOML. */
export function parseCargoManifest(text: string): DeclaredDep[] {
  const ast = parseTomlAst(text);
  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];
  for (const node of ast.body[0].body) {
    if (node.type !== "TOMLTable") continue;
    const info = classify(node.resolvedKey.map(String));
    if (!info) continue;
    if (!info.sub) {
      deps.push(...entriesOf(node.body).map((e) => toDep(e, info.group, text, ix)));
    } else {
      const last = node.key.keys.at(-1)!;
      const props = new Map<string, TOMLContentNode>();
      for (const kv of node.body) {
        const prop = keyName(kv);
        if (prop !== undefined) props.set(prop, kv.value);
      }
      const key = String(node.resolvedKey.at(-1));
      deps.push(toDep({ key, keyRange: keyRangeOf(last), props }, info.group, text, ix));
    }
  }
  return deps;
}

function hasWorkspaceTable(text: string): boolean {
  try {
    return parseTomlAst(text).body[0].body.some((n) => n.type === "TOMLTable" && n.resolvedKey[0] === "workspace");
  } catch (e) {
    if (e instanceof ParseError) return false;
    throw e;
  }
}

/** Fills `workspace = true` dependencies from the nearest ancestor Cargo.toml that declares a `[workspace]`. */
export async function resolveCargoWorkspace(
  deps: DeclaredDep[],
  ctx: { manifestPath: string; rootDir: string; files: FileSource },
): Promise<DeclaredDep[]> {
  if (!deps.some((d) => d.group?.endsWith(WORKSPACE_SUFFIX))) return deps;

  let workspace: { path: string; deps: DeclaredDep[] } | undefined;
  for (let dir = dirname(ctx.manifestPath); ; dir = dirname(dir)) {
    const path = join(dir, "Cargo.toml");
    const text = await ctx.files.read(path);
    if (text !== undefined && hasWorkspaceTable(text)) {
      workspace = { path, deps: parseCargoManifest(text) };
      break;
    }
    if (dir === ctx.rootDir || dirname(dir) === dir) break;
  }

  return deps.map((dep) => {
    if (!dep.group?.endsWith(WORKSPACE_SUFFIX)) return dep;
    const group = dep.group.slice(0, -WORKSPACE_SUFFIX.length);
    const source = workspace?.deps.find((d) => d.group === "workspace.dependencies" && declaredKeys.get(d) === declaredKeys.get(dep));
    if (!source?.rawSpec || !source.specRange) return { ...dep, group };
    return {
      ...dep,
      name: source.name,
      group,
      rawSpec: source.rawSpec,
      lowerBound: source.lowerBound,
      kind: source.kind,
      specLocation: { path: workspace!.path, range: source.specRange, rawSpec: source.rawSpec },
    };
  });
}
