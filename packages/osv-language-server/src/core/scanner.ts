import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ALL_MODULES, classifyFile } from "../ecosystems/index.js";
import { ParseError, type EcosystemModule } from "../ecosystems/types.js";
import { mergeAliases } from "./aliases.js";
import type { FileSource } from "./fileSource.js";
import { calculateFix, isAffected } from "./fixCalculator.js";
import { findingKey } from "./findingKey.js";
import type { IgnoreMatcher } from "./ignores.js";
import { findLockfile, findManifestForLockfile, nameKeyOf, pickLockedEntry, resolveVersion } from "./lockfileResolver.js";
import type { OsvService } from "./osvService.js";
import { queryKey } from "./osvService.js";
import { isEcosystemEnabled, type Settings } from "./settings.js";
import { maxSeverity, severityRank } from "./severity.js";
import type { DeclaredDep, Finding, OsvRecord, PackageQuery, ResolvedDep, Severity, TextRange, UpdatePlan, Vuln } from "./types.js";

export interface ScanContext {
  files: FileSource;
  osv: { lookup: OsvService["lookup"] };
  settings: Settings;
  ignores: IgnoreMatcher;
  rootDir: string;
  modules?: EcosystemModule[];
  /** Receives warnings such as skipped malformed OSV records; defaults to stderr. */
  log?: (message: string) => void;
}

type LookupResults = Map<string, { records: OsvRecord[]; cached: boolean }>;

export interface PreparedScan {
  queries: PackageQuery[];
  finalize(results: LookupResults): Finding[];
}

export interface ScanResult {
  findings: Finding[];
  offline: boolean;
  parseError: boolean;
}

/** A dependency to check, plus what is needed to build its finding once records arrive. */
interface Candidate {
  name: string;
  version: string;
  range: TextRange;
  source: "manifest" | "lockfile";
  direct: boolean;
  checkedLowerBound: boolean;
  via?: string[] | undefined;
  buildUpdate(target: string): UpdatePlan | undefined;
}

const MIN_RANK: Record<Settings["minimumSeverity"], number> = { low: 1, medium: 2, high: 3, critical: 4 };

function parseOrThrow<T>(fn: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false };
    throw e;
  }
}

function hasNodeModulesSegment(path: string): boolean {
  return path.split(/[\\/]/).includes("node_modules");
}

/** Parsers mark a version that lives in the manifest itself with specLocation.path ""; point it at that file. */
function anchorSpecLocations(deps: DeclaredDep[], manifestPath: string): DeclaredDep[] {
  return deps.map((d) => (d.specLocation?.path === "" ? { ...d, specLocation: { ...d.specLocation, path: manifestPath } } : d));
}

function siblingUri(uri: string, path: string): string {
  return uri.slice(0, uri.lastIndexOf("/") + 1) + encodeURIComponent(basename(path));
}

export async function prepareDocument(
  uri: string,
  path: string,
  text: string,
  ctx: ScanContext,
): Promise<PreparedScan | { parseError: true } | undefined> {
  const { settings } = ctx;
  if (!settings.enable) return undefined;
  if (hasNodeModulesSegment(path)) return undefined;
  const rel = relative(ctx.rootDir, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  const hit = classifyFile(rel.split(sep).join("/"), ctx.modules ?? ALL_MODULES);
  if (!hit) return undefined;
  const { module, role } = hit;
  if (!isEcosystemEnabled(settings, module.id)) return undefined;
  if (role === "lockfile" && !settings.scanLockfiles) return undefined;

  const candidates: Candidate[] = [];
  const fileName = basename(path);

  if (role === "manifest") {
    const parsed = parseOrThrow(() => module.parseManifest(text, fileName));
    if (!parsed.ok) return { parseError: true };
    const deps = module.resolveExternal
      ? await module.resolveExternal(anchorSpecLocations(parsed.value, path), { manifestPath: path, rootDir: ctx.rootDir, files: ctx.files })
      : anchorSpecLocations(parsed.value, path);
    const lockFile = module.manifestIsExact ? undefined : await findLockfile(path, module, ctx.rootDir, ctx.files);
    let locked: ResolvedDep[] | undefined;
    if (lockFile) {
      const l = parseOrThrow(() => module.parseLockfile(lockFile.text, basename(lockFile.path)));
      if (l.ok) locked = l.value;
    }
    const lockfilePath = locked ? lockFile?.path : undefined;
    for (const dep of deps) {
      const resolved = resolveVersion(dep, locked, module);
      if (!resolved) continue;
      candidates.push({
        name: resolved.name,
        version: resolved.version,
        range: dep.specRange ?? dep.nameRange,
        source: "manifest",
        direct: true,
        checkedLowerBound: !resolved.fromLockfile && module.manifestIsExact !== true,
        buildUpdate: (target) => directUpdate(module, dep, uri, path, lockfilePath, target, text),
      });
    }
  } else {
    const parsed = parseOrThrow(() => module.parseLockfile(text, fileName));
    if (!parsed.ok) return { parseError: true };
    const manifestFile = await findManifestForLockfile(path, module, ctx.files);
    let declared: DeclaredDep[] | undefined;
    if (manifestFile) {
      const m = parseOrThrow(() => module.parseManifest(manifestFile.text, basename(manifestFile.path)));
      if (m.ok) {
        declared = module.resolveExternal
          ? await module.resolveExternal(anchorSpecLocations(m.value, manifestFile.path), { manifestPath: manifestFile.path, rootDir: ctx.rootDir, files: ctx.files })
          : anchorSpecLocations(m.value, manifestFile.path);
      }
    }
    const manifestUri = manifestFile ? siblingUri(uri, manifestFile.path) : undefined;
    const key = nameKeyOf(module);
    const declaredByName = new Map((declared ?? []).map((d) => [key(d.name), d]));
    // The manifest promotes only the copy its declaration resolves to; other copies (nested
    // installs, other versions) keep the parser's direct flag and via chain. When the copy cannot
    // be told apart (npm v1 / yarn v1, Task 10 ruling), every copy is promoted as before.
    const picked = new Map<DeclaredDep, ResolvedDep | undefined>();
    for (const d of declaredByName.values()) picked.set(d, pickLockedEntry(d, parsed.value, module));
    for (const r of parsed.value) {
      const decl = declaredByName.get(key(r.name));
      const pick = decl && picked.get(decl);
      const direct = r.direct || (decl !== undefined && (pick === undefined || pick === r));
      candidates.push({
        name: r.name,
        version: r.version,
        range: r.range,
        source: "lockfile",
        direct,
        checkedLowerBound: false,
        via: direct ? undefined : r.via,
        buildUpdate: (target) => {
          if (direct) {
            if (!decl || !manifestFile || !manifestUri) return undefined;
            return directUpdate(module, decl, manifestUri, manifestFile.path, path, target, manifestFile.text);
          }
          return module.transitiveFix({
            name: r.name,
            current: r.version,
            target,
            lockfilePath: path,
            ...(manifestFile && manifestUri ? { manifestPath: manifestFile.path, manifestUri, manifestText: manifestFile.text } : {}),
          });
        },
      });
    }
  }

  // Client-side matching sends one package-only query per name; the version is applied at finalize.
  const queryVersion = (c: Candidate): string => (module.clientSideMatching ? "" : c.version);
  const queries = new Map<string, PackageQuery>();
  for (const c of candidates) {
    const q = { ecosystem: module.osvEcosystem, name: c.name, version: queryVersion(c) };
    queries.set(queryKey(q), q);
  }

  return {
    queries: [...queries.values()],
    finalize(results) {
      const findings: Finding[] = [];
      for (const c of candidates) {
        const found = results.get(queryKey({ ecosystem: module.osvEcosystem, name: c.name, version: queryVersion(c) }));
        if (!found || found.records.length === 0) continue;
        let records = found.records.filter((r) => {
          if (isWellFormedRecord(r)) return true;
          (ctx.log ?? logToStderr)(`skipped malformed OSV record ${typeof r?.id === "string" ? r.id : "(no id)"} for ${c.name}`);
          return false;
        });
        if (module.clientSideMatching) {
          const key = nameKeyOf(module);
          records = records.filter((r) => isAffected([r], module.osvEcosystem, c.name, c.version, module.versioning, key));
        }
        if (records.length === 0) continue;
        const vulns = mergeAliases(records).filter((v) => !ctx.ignores.isIgnored(v) && passesSeverity(v, settings));
        if (vulns.length === 0) continue;
        const fix = calculateFix(records, module.osvEcosystem, c.name, c.version, module.versioning, nameKeyOf(module));
        const update = fix.target === undefined ? undefined : c.buildUpdate(fix.target);
        const finding: Finding = {
          key: findingKey({ source: c.source, ecosystem: module.osvEcosystem, name: c.name, current: c.version, range: c.range }),
          uri,
          range: c.range,
          ecosystem: module.osvEcosystem,
          name: c.name,
          current: c.version,
          checkedLowerBound: c.checkedLowerBound,
          source: c.source,
          direct: c.direct,
          ...(c.via ? { via: c.via } : {}),
          vulns,
          severity: maxSeverity(vulns.map((v): Severity => v.severity)),
          fix,
          ...(update ? { update } : {}),
          cached: found.cached,
        };
        findings.push(finding);
      }
      return findings;
    },
  };

  function directUpdate(
    mod: EcosystemModule,
    dep: DeclaredDep,
    manifestUri: string,
    manifestPath: string,
    lockfilePath: string | undefined,
    target: string,
    manifestText: string,
  ): UpdatePlan {
    const edit: UpdatePlan["edit"] = [];
    let widened: boolean | undefined;
    if (dep.specLocation) {
      const rewritten = mod.rewriteSpec(dep.specLocation.rawSpec, target);
      edit.push({ uri: pathToFileURL(dep.specLocation.path).href, range: dep.specLocation.range, newText: rewritten.spec });
      widened = rewritten.widened;
    } else if (dep.specRange && dep.rawSpec !== undefined) {
      const rewritten = mod.rewriteSpec(dep.rawSpec, target);
      edit.push({ uri: manifestUri, range: dep.specRange, newText: rewritten.spec });
      widened = rewritten.widened;
    }
    const command = mod.lockCommand({ manifestPath, manifestText, ...(lockfilePath ? { lockfilePath } : {}), name: dep.name, target });
    return {
      edit,
      ...(command !== undefined ? { lockCommand: { cwd: dirname(lockfilePath ?? manifestPath), command } } : {}),
      kind: "direct",
      ...(widened !== undefined ? { widened } : {}),
    };
  }
}

const logToStderr = (message: string): void => void process.stderr.write(`${message}\n`);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Whether a record has the shape the fix calculator walks; a malformed one is skipped (spec §14.2). */
function isWellFormedRecord(r: OsvRecord): boolean {
  if (!isObject(r) || typeof r.id !== "string") return false;
  if (r.affected === undefined) return true;
  if (!Array.isArray(r.affected)) return false;
  return r.affected.every(
    (a: unknown) =>
      isObject(a) &&
      (a.package === undefined || (isObject(a.package) && typeof a.package.name === "string")) &&
      (a.versions === undefined || Array.isArray(a.versions)) &&
      (a.ranges === undefined ||
        (Array.isArray(a.ranges) && a.ranges.every((rg: unknown) => isObject(rg) && Array.isArray(rg.events) && rg.events.every(isObject)))),
  );
}

/** Unknown severity is kept: hiding a vulnerability of unknown severity would fail open. */
function passesSeverity(v: Vuln, settings: Settings): boolean {
  return v.severity === "unknown" || severityRank(v.severity) >= MIN_RANK[settings.minimumSeverity];
}

export async function scanDocument(uri: string, path: string, text: string, ctx: ScanContext, signal?: AbortSignal): Promise<ScanResult> {
  const prepared = await prepareDocument(uri, path, text, ctx);
  if (!prepared) return { findings: [], offline: false, parseError: false };
  if ("parseError" in prepared) return { findings: [], offline: false, parseError: true };
  if (prepared.queries.length === 0) return { findings: [], offline: false, parseError: false };
  const outcome = await ctx.osv.lookup(prepared.queries, signal);
  return { findings: prepared.finalize(outcome.results), offline: outcome.offline, parseError: false };
}
