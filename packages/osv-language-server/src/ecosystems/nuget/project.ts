import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { LineIndex } from "../../core/lineIndex.js";
import { childText, parseXml, type XmlElement } from "../../core/xml.js";
import type { FileSource } from "../../core/fileSource.js";
import type { DeclaredDep, TextRange } from "../../core/types.js";
import { nugetLowerBound } from "./range.js";

const MAX_REF_DEPTH = 5;
const WHOLE_REF = /^\$\(([^$()]+)\)$/;
const PACKAGES_PROPS = "Directory.Packages.props";

/** Property name -> element, from every `<PropertyGroup>`; the last definition wins as in MSBuild. */
function propertiesOf(root: XmlElement): Map<string, XmlElement> {
  const props = new Map<string, XmlElement>();
  for (const group of root.children) {
    if (group.name !== "PropertyGroup") continue;
    for (const el of group.children) if (el.text !== "") props.set(el.name, el);
  }
  return props;
}

function resolveProperty(props: Map<string, XmlElement>, ref: string, depth = 0): XmlElement | undefined {
  if (depth > MAX_REF_DEPTH) return undefined;
  const el = props.get(ref);
  if (!el) return undefined;
  const alias = WHOLE_REF.exec(el.text);
  if (alias) return resolveProperty(props, alias[1]!, depth + 1);
  return el.text.includes("$(") ? undefined : el;
}

/** A version attribute or child element, as text and its offsets. */
interface VersionSource {
  text: string;
  start: number;
  end: number;
}

function versionSource(el: XmlElement, name: string): VersionSource | undefined {
  const attr = el.attrs.get(name);
  if (attr) return { text: attr.value.trim(), start: attr.valueStart, end: attr.valueEnd };
  const child = childText(el, name);
  if (child && child.textStart >= 0) return { text: child.text, start: child.textStart, end: child.textEnd };
  return undefined;
}

function* itemsNamed(root: XmlElement, tag: string): Generator<XmlElement> {
  for (const group of root.children) {
    if (group.name !== "ItemGroup") continue;
    for (const el of group.children) if (el.name === tag) yield el;
  }
}

interface ItemSpec {
  tag: string;
  /** Attributes naming the package, in preference order. */
  nameAttrs: string[];
  /** Version sources, in preference order. */
  versions: string[];
  group: string;
}

function makeDep(el: XmlElement, spec: ItemSpec, ix: LineIndex, props: Map<string, XmlElement>): DeclaredDep | undefined {
  const nameAttrName = spec.nameAttrs.find((a) => el.attrs.has(a));
  const nameAttr = nameAttrName === undefined ? undefined : el.attrs.get(nameAttrName)!;
  if (!nameAttr || nameAttr.value.trim() === "" || nameAttr.value.includes("$(")) return undefined;
  const name = nameAttr.value.trim();
  const nameRange = ix.range(nameAttr.valueStart, nameAttr.valueEnd);
  const source = spec.versions.map((v) => versionSource(el, v)).find((v) => v !== undefined && v.text !== "");
  if (!source) {
    // A bare Update only modifies another reference's metadata.
    if (nameAttrName === "Update") return undefined;
    return { name, nameRange, kind: "unresolved", group: spec.group === "dependencies" ? "cpm" : spec.group };
  }
  const specRange = ix.range(source.start, source.end);
  const base = { name, nameRange, specRange, group: spec.group };
  const ref = WHOLE_REF.exec(source.text)?.[1];
  let rawSpec = source.text;
  let specLocation: DeclaredDep["specLocation"];
  if (ref !== undefined) {
    const hit = resolveProperty(props, ref);
    if (!hit) return { ...base, kind: "unresolved" };
    rawSpec = hit.text;
    specLocation = { path: "", range: ix.range(hit.textStart, hit.textEnd), rawSpec };
  } else if (source.text.includes("$(")) {
    return { ...base, kind: "unresolved" };
  }
  const lowerBound = nugetLowerBound(rawSpec);
  return {
    ...base,
    rawSpec,
    ...(specLocation ? { specLocation } : {}),
    lowerBound,
    kind: lowerBound === undefined ? "unresolved" : "registry",
  };
}

function parseItems(text: string, specs: ItemSpec[]): DeclaredDep[] {
  const root = parseXml(text);
  const ix = new LineIndex(text);
  const props = propertiesOf(root);
  const deps: DeclaredDep[] = [];
  for (const spec of specs) {
    for (const el of itemsNamed(root, spec.tag)) {
      const dep = makeDep(el, spec, ix, props);
      if (dep) deps.push(dep);
    }
  }
  return deps;
}

/**
 * PackageReference items of a csproj, fsproj, vbproj or Directory.Build.props. A reference without a version
 * is `unresolved` with group `cpm`, for `resolveCentralVersions`. Throws ParseError on invalid XML.
 */
export function parseProjectFile(text: string): DeclaredDep[] {
  return parseItems(text, [
    { tag: "PackageReference", nameAttrs: ["Include", "Update"], versions: ["VersionOverride", "Version"], group: "dependencies" },
  ]);
}

/** PackageVersion and GlobalPackageReference items of a Directory.Packages.props. Throws ParseError on invalid XML. */
export function parsePackagesProps(text: string): DeclaredDep[] {
  return parseItems(text, [
    { tag: "PackageVersion", nameAttrs: ["Include", "Update"], versions: ["Version"], group: "PackageVersion" },
    { tag: "GlobalPackageReference", nameAttrs: ["Include", "Update"], versions: ["Version"], group: "GlobalPackageReference" },
  ]);
}

/** The nearest Directory.Packages.props from the manifest's directory up to rootDir (inclusive). */
async function findPackagesProps(manifestPath: string, rootDir: string, files: FileSource): Promise<{ path: string; text: string } | undefined> {
  const root = resolve(rootDir);
  let dir = dirname(resolve(manifestPath));
  const rel = relative(root, dir);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  for (;;) {
    const path = join(dir, PACKAGES_PROPS);
    const text = await files.read(path);
    if (text !== undefined) return { path, text };
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

/** Fills versionless references (central package management) from the nearest Directory.Packages.props. */
export async function resolveCentralVersions(
  deps: DeclaredDep[],
  ctx: { manifestPath: string; rootDir: string; files: FileSource },
): Promise<DeclaredDep[]> {
  if (!deps.some((d) => d.group === "cpm" && d.kind === "unresolved" && d.rawSpec === undefined)) return deps;
  const found = await findPackagesProps(ctx.manifestPath, ctx.rootDir, ctx.files);
  if (!found) return deps;
  let central: DeclaredDep[];
  try {
    central = parsePackagesProps(found.text);
  } catch {
    return deps;
  }
  const byName = new Map<string, DeclaredDep>();
  for (const c of central) {
    const key = c.name.toLowerCase();
    if (c.rawSpec !== undefined && !byName.has(key)) byName.set(key, c);
  }
  return deps.map((dep) => {
    if (dep.group !== "cpm" || dep.rawSpec !== undefined) return dep;
    const hit = byName.get(dep.name.toLowerCase());
    if (!hit || !hit.specRange || hit.rawSpec === undefined) return dep;
    const where = hit.specLocation
      ? { ...hit.specLocation, path: hit.specLocation.path || found.path }
      : { path: found.path, range: hit.specRange as TextRange, rawSpec: hit.rawSpec };
    return { ...dep, rawSpec: hit.rawSpec, lowerBound: hit.lowerBound, kind: hit.kind, specLocation: where };
  });
}
