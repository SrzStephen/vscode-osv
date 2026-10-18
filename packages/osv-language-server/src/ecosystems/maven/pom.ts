import { dirname, isAbsolute, join, relative } from "node:path";
import { LineIndex } from "../../core/lineIndex.js";
import { childText, childrenNamed, parseXml, type XmlElement } from "../../core/xml.js";
import type { DeclaredDep, TextRange } from "../../core/types.js";
import type { FileSource } from "../../core/fileSource.js";
import { ParseError } from "../types.js";
import { mavenLowerBound } from "./range.js";

const MAX_PARENT_LEVELS = 5;
const MAX_REF_DEPTH = 5;
const DEFAULT_PLUGIN_GROUP = "org.apache.maven.plugins";
const WHOLE_REF = /^\$\{([^${}]+)\}$/;

/** Dependencies still needing a version from another file (or a managed one). */
const pending = new WeakMap<DeclaredDep, { ref?: string }>();

/** Name -> element for the direct children of `<properties>`. */
function propertiesOf(root: XmlElement): Map<string, XmlElement> {
  const props = new Map<string, XmlElement>();
  for (const el of childText(root, "properties")?.children ?? []) props.set(el.name, el);
  return props;
}

/** The element whose text is a built-in reference's value (`project.version`, `project.parent.version`). */
function builtinRef(root: XmlElement, ref: string): XmlElement | undefined {
  const parentVersion = descend(root, "parent", "version");
  if (ref === "project.parent.version" || ref === "parent.version") return parentVersion;
  if (ref === "project.version" || ref === "pom.version" || ref === "version") return childText(root, "version") ?? parentVersion;
  return undefined;
}

interface Located {
  el: XmlElement;
  /** Index of the file the element is in. */
  file: number;
}

interface PomFile {
  path: string;
  text: string;
  ix: LineIndex;
  root: XmlElement;
  props: Map<string, XmlElement>;
}

const textRange = (f: PomFile, el: XmlElement): TextRange => f.ix.range(el.textStart, el.textEnd);

/** Finds the element a property reference resolves to, searching `files` in order, chasing aliases. */
function resolveRef(files: PomFile[], ref: string, depth = 0): Located | undefined {
  if (depth > MAX_REF_DEPTH) return undefined;
  const builtin = builtinRef(files[0]!.root, ref);
  const candidates: Located[] = [];
  if (builtin) candidates.push({ el: builtin, file: 0 });
  files.forEach((f, file) => {
    const el = f.props.get(ref);
    if (el) candidates.push({ el, file });
  });
  const hit = candidates.find((c) => c.el.text !== "");
  if (!hit) return undefined;
  const alias = WHOLE_REF.exec(hit.el.text);
  if (alias) return resolveRef(files, alias[1]!, depth + 1);
  return hit.el.text.includes("${") ? undefined : hit;
}

/** Follows a chain of child element names; undefined if any link is missing. */
function descend(el: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  return names.reduce<XmlElement | undefined>((cur, n) => (cur ? childText(cur, n) : undefined), el);
}

function entries(listEl: XmlElement | undefined, tag: string): XmlElement[] {
  return listEl ? childrenNamed(listEl, tag) : [];
}

interface Collected {
  el: XmlElement;
  group: string;
  isPlugin: boolean;
}

function collect(root: XmlElement): Collected[] {
  const out: Collected[] = [];
  const add = (container: XmlElement | undefined, tag: string, group: string, isPlugin: boolean) => {
    for (const el of entries(container, tag)) out.push({ el, group, isPlugin });
  };
  add(childText(root, "dependencies"), "dependency", "dependencies", false);
  add(descend(root, "dependencyManagement", "dependencies"), "dependency", "dependencyManagement", false);
  add(descend(root, "build", "plugins"), "plugin", "plugins", true);
  for (const profile of entries(childText(root, "profiles"), "profile")) {
    add(childText(profile, "dependencies"), "dependency", `profile:${childText(profile, "id")?.text ?? ""}`, false);
  }
  return out;
}

function coordinates(c: Collected): { name: string; artifact: XmlElement } | undefined {
  const artifact = childText(c.el, "artifactId");
  if (!artifact || artifact.text === "") return undefined;
  const group = childText(c.el, "groupId")?.text || (c.isPlugin ? DEFAULT_PLUGIN_GROUP : "");
  if (!group) return undefined;
  return { name: `${group}:${artifact.text}`, artifact };
}

const skippedScope = (el: XmlElement) => {
  const scope = childText(el, "scope")?.text;
  return scope === "import" || scope === "system";
};

function makeDep(
  c: Collected,
  file: PomFile,
  files: PomFile[],
): DeclaredDep | undefined {
  const coords = coordinates(c);
  if (!coords || skippedScope(c.el)) return undefined;
  const base = { name: coords.name, nameRange: textRange(file, coords.artifact), group: c.group };
  const version = childText(c.el, "version");
  if (!version || version.text === "") {
    const dep: DeclaredDep = { ...base, kind: "unresolved" };
    pending.set(dep, {});
    return dep;
  }
  const specRange = textRange(file, version);
  const ref = WHOLE_REF.exec(version.text)?.[1];
  if (ref === undefined && version.text.includes("${")) {
    return { ...base, specRange, kind: "unresolved" };
  }
  if (ref === undefined) {
    const lowerBound = mavenLowerBound(version.text);
    return { ...base, rawSpec: version.text, specRange, lowerBound, kind: lowerBound === undefined ? "unresolved" : "registry" };
  }
  const hit = resolveRef(files, ref);
  if (!hit) {
    const dep: DeclaredDep = { ...base, specRange, kind: "unresolved" };
    pending.set(dep, { ref });
    return dep;
  }
  const rawSpec = hit.el.text;
  const lowerBound = mavenLowerBound(rawSpec);
  return {
    ...base,
    rawSpec,
    specRange,
    specLocation: { path: files[hit.file]!.path, range: textRange(files[hit.file]!, hit.el), rawSpec },
    lowerBound,
    kind: lowerBound === undefined ? "unresolved" : "registry",
  };
}

function loadFile(path: string, text: string): PomFile {
  const root = parseXml(text);
  return { path, text, ix: new LineIndex(text), root, props: propertiesOf(root) };
}

/** Dependencies, managed dependencies, plugins and profile dependencies from a pom.xml. Throws ParseError on invalid XML. */
export function parsePom(text: string): DeclaredDep[] {
  const file = loadFile("", text);
  const deps: DeclaredDep[] = [];
  for (const c of collect(file.root)) {
    const dep = makeDep(c, file, [file]);
    if (dep) deps.push(dep);
  }
  return deps;
}

/** The pom a `<parent>` points at, when it is readable inside `rootDir`. */
async function readParent(file: PomFile, rootDir: string, files: FileSource): Promise<PomFile | undefined> {
  const parent = childText(file.root, "parent");
  if (!parent) return undefined;
  const rel = childText(parent, "relativePath");
  if (rel && rel.text === "") return undefined;
  let path = join(dirname(file.path), rel?.text || "../pom.xml");
  if (!path.endsWith(".xml")) path = join(path, "pom.xml");
  const fromRoot = relative(rootDir, path);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return undefined;
  const text = await files.read(path);
  if (text === undefined) return undefined;
  try {
    return loadFile(path, text);
  } catch (e) {
    if (e instanceof ParseError) return undefined;
    throw e;
  }
}

/** `groupId:artifactId` -> version element for managed dependencies or plugins. */
function managedVersions(root: XmlElement, plugins: boolean): Map<string, XmlElement> {
  const out = new Map<string, XmlElement>();
  const container = plugins ? descend(root, "build", "pluginManagement", "plugins") : descend(root, "dependencyManagement", "dependencies");
  for (const el of entries(container, plugins ? "plugin" : "dependency")) {
    const coords = coordinates({ el, group: "", isPlugin: plugins });
    const version = childText(el, "version");
    if (coords && version && version.text !== "") out.set(coords.name, version);
  }
  return out;
}

/**
 * Resolves still-unresolved `${prop}` versions and missing versions from the same file's
 * `<dependencyManagement>` and from parent POMs inside the workspace (up to 5 levels).
 */
export async function resolvePomParent(
  deps: DeclaredDep[],
  ctx: { manifestPath: string; rootDir: string; files: FileSource },
): Promise<DeclaredDep[]> {
  if (!deps.some((d) => pending.has(d))) return deps;
  const ownText = await ctx.files.read(ctx.manifestPath);
  if (ownText === undefined) return deps;
  let own: PomFile;
  try {
    own = loadFile(ctx.manifestPath, ownText);
  } catch (e) {
    if (e instanceof ParseError) return deps;
    throw e;
  }
  const files = [own];
  for (let i = 0; i < MAX_PARENT_LEVELS; i++) {
    const next = await readParent(files[files.length - 1]!, ctx.rootDir, ctx.files);
    if (!next || files.some((f) => f.path === next.path)) break;
    files.push(next);
  }
  const dm = files.map((f) => managedVersions(f.root, false));
  const pm = files.map((f) => managedVersions(f.root, true));

  return deps.map((dep) => {
    const info = pending.get(dep);
    if (!info) return dep;
    let hit: Located | undefined;
    if (info.ref !== undefined) {
      hit = resolveRef(files, info.ref);
    } else {
      const maps = dep.group === "plugins" ? pm : dm;
      for (let i = 0; i < files.length && !hit; i++) {
        const version = maps[i]!.get(dep.name);
        if (!version) continue;
        const ref = WHOLE_REF.exec(version.text)?.[1];
        if (ref !== undefined) hit = resolveRef(files, ref);
        else if (!version.text.includes("${")) hit = { el: version, file: i };
        break;
      }
    }
    if (!hit) return dep;
    const rawSpec = hit.el.text;
    const lowerBound = mavenLowerBound(rawSpec);
    const file = files[hit.file]!;
    return {
      ...dep,
      rawSpec,
      lowerBound,
      kind: lowerBound === undefined ? "unresolved" : "registry",
      specLocation: { path: file.path, range: textRange(file, hit.el), rawSpec },
    };
  });
}
