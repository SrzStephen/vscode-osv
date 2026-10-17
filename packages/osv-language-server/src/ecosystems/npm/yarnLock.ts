import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { ParseError } from "../types.js";
import { checkVersion, readYamlTree, resolveEntries, yamlChild, type LockEntry } from "./lockCommon.js";

/** Splits `name@spec` at the first `@` after a possible scope marker. */
function splitSpec(key: string): [name: string, spec: string] {
  const at = key.indexOf("@", 1);
  if (at < 1) throw new ParseError("Invalid yarn lockfile key");
  return [key.slice(0, at), key.slice(at + 1)];
}

/** Parses yarn.lock, classic (v1 line format) or berry (YAML). Throws ParseError on invalid input. */
export function parseYarnLock(text: string): ResolvedDep[] {
  if (text !== "" && !text.endsWith("\n")) throw new ParseError("Truncated yarn.lock");
  return /^__metadata:/m.test(text) ? parseBerry(text) : parseClassic(text);
}

function parseClassic(text: string): ResolvedDep[] {
  const ix = new LineIndex(text);
  const blocks: Array<{ specs: string[]; version?: string; range?: LockEntry["range"]; deps: string[][] }> = [];
  let block: (typeof blocks)[number] | undefined;
  let inDeps = false;

  for (let pos = 0; pos < text.length; ) {
    const eol = text.indexOf("\n", pos);
    const end = eol === -1 ? text.length : eol;
    const line = text.slice(pos, end).replace(/\r$/, "");
    const lineStart = pos;
    pos = end + 1;
    if (line.trim() === "" || line.startsWith("#")) continue;

    if (line[0] !== " ") {
      if (!line.endsWith(":")) throw new ParseError("Invalid yarn.lock entry");
      block = { specs: line.slice(0, -1).split(", ").map((s) => s.replace(/^"|"$/g, "")), deps: [] };
      blocks.push(block);
      inDeps = false;
    } else if (!block) {
      throw new ParseError("Invalid yarn.lock entry");
    } else if (line[2] !== " ") {
      const field = /^ {2}(\S+?)(:| (.+))$/.exec(line);
      if (!field) throw new ParseError("Invalid yarn.lock field");
      inDeps = field[1] === "dependencies" || field[1] === "optionalDependencies";
      if (field[1] === "version") {
        const value = /^"([^"]+)"$/.exec(field[3] ?? "");
        if (!value) throw new ParseError("Invalid yarn.lock version");
        const start = lineStart + line.indexOf('"') + 1;
        block.version = value[1];
        block.range = ix.range(start, start + value[1]!.length);
      }
    } else if (inDeps) {
      const dep = /^ {4}(?:"([^"]+)"|(\S+)) "([^"]*)"$/.exec(line);
      if (!dep) throw new ParseError("Invalid yarn.lock dependency");
      block.deps.push([dep[1] ?? dep[2]!, dep[3]!]);
    }
  }

  const idOf = new Map<string, string>();
  for (const b of blocks) for (const s of b.specs) idOf.set(s, b.specs[0]!);
  const entries: LockEntry[] = blocks.map((b) => {
    if (b.version === undefined || !b.range) throw new ParseError("Missing version in yarn.lock entry");
    const specs = b.specs.map(splitSpec);
    return {
      id: b.specs[0]!,
      name: specs[0]![0],
      version: b.version,
      range: b.range,
      requestedSpecs: specs.map(([, spec]) => spec),
      edges: b.deps.flatMap(([name, spec]) => idOf.get(`${name}@${spec}`) ?? []),
    };
  });
  return resolveEntries(entries);
}

function parseBerry(text: string): ResolvedDep[] {
  const ix = new LineIndex(text);
  const idOf = new Map<string, string>();
  const pending: Array<{ entry: LockEntry; deps: Array<[string, string]> }> = [];
  const workspaceDeps: Array<[string, string]> = [];
  const npm = (spec: string) => spec.replace(/^npm:/, "");

  const nodes = readYamlTree(text, "yarn.lock");
  if (!yamlChild(nodes.find((n) => n.key === "__metadata"), "version")?.value || nodes.length < 2) {
    throw new ParseError("Incomplete yarn.lock");
  }
  for (const node of nodes) {
    if (node.key === "__metadata") continue;
    const specs = node.key.split(", ").map(splitSpec);
    const deps = (yamlChild(node, "dependencies")?.children ?? []).map((d): [string, string] => [d.key, npm(d.value)]);
    if (specs.some(([, spec]) => spec.startsWith("workspace:"))) {
      workspaceDeps.push(...deps);
      continue;
    }
    const version = yamlChild(node, "version");
    if (!version || specs.some(([, spec]) => spec.startsWith("patch:"))) continue;
    for (const [name, spec] of specs) idOf.set(`${name}@${npm(spec)}`, node.key);
    pending.push({
      entry: {
        id: node.key,
        name: specs[0]![0],
        version: checkVersion(version.value, "yarn.lock"),
        range: ix.range(version.valueStart, version.valueStart + version.value.length),
        requestedSpecs: specs.map(([, spec]) => npm(spec)),
        edges: [],
      },
      deps,
    });
  }

  for (const { entry, deps } of pending) entry.edges = deps.flatMap(([n, s]) => idOf.get(`${n}@${s}`) ?? []);
  // The workspace entry is what records the direct dependencies.
  const direct = workspaceDeps.flatMap(([n, s]) => idOf.get(`${n}@${s}`) ?? []);
  return resolveEntries(pending.map((p) => p.entry), workspaceDeps.length > 0 ? direct : undefined);
}
