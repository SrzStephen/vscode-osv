import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pkg from "../package.json";
import { DiskCache } from "./core/cache.js";
import { defaultCacheDir } from "./core/cacheDir.js";
import { nodeFileSource } from "./core/fileSource.js";
import { findOsvScannerToml, IgnoreMatcher, parseOsvScannerToml } from "./core/ignores.js";
import { OsvClient } from "./core/osvClient.js";
import { OsvService } from "./core/osvService.js";
import { createDispatcher } from "./core/tls.js";
import { USER_AGENT } from "./core/userAgent.js";
import type { ScanContext } from "./core/scanner.js";
import { DEFAULT_SETTINGS, type MinimumSeverity, type Settings } from "./core/settings.js";
import type { Finding } from "./core/types.js";
import { discoverFiles, scanFiles } from "./core/workspaceScanner.js";
import { ALL_MODULES, classifyFile } from "./ecosystems/index.js";

export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const USAGE = `Usage: osv-check [options] [paths...]

Checks dependency manifests and lockfiles against osv.dev.
With no paths, every manifest and lockfile under the current directory is checked.

Options:
  --min-severity <level>      low|medium|high|critical (default: low)
  --only-fixable              hide findings that have no official fix yet
  --format <format>           text|json|tree (default: text)
  --strict                    exit 2 if osv.dev is unreachable and nothing is cached
  --no-lockfiles              skip lockfile entries
  --disable-ecosystem <id>    do not scan this ecosystem; repeatable (${ALL_MODULES.map((m) => m.id).join(", ")})
  --ignore <id>               suppress a vulnerability by any alias (GHSA, CVE, ...); repeatable
  --cache-dir <dir>           override the cache location
  --cache-ttl-hours <n>       how long cached results stay fresh (default: 48, minimum 1)
  --api-base-url <url>        override the OSV API base URL
  --ca-certificate-path <f>   PEM file of extra CA certificates to trust
  --help                      show this help
  --version                   show the version

Exit codes: 0 no findings, 1 findings, 2 usage error or network failure under --strict.
`;

const SEVERITY_LEVELS: readonly string[] = ["low", "medium", "high", "critical"];
/** Most severe first, for the summary breakdown (the status bar uses the same order). */
const SEVERITY_ORDER = ["critical", "high", "medium", "low", "unknown"] as const;
const FORMATS: readonly string[] = ["text", "json", "tree"];
const OFFLINE_WARNING = "warning: osv.dev unreachable and no cached data; results incomplete\n";
const INCOMPLETE_SUMMARY = "Results incomplete: no vulnerability data (OSV unreachable, no cache)\n";

/**
 * One line per finding plus a summary line. When the lookup was incomplete the summary says so, so it
 * never implies a complete result (a clean one would be a false pass).
 */
export function formatText(findings: Finding[], cwd: string, incomplete = false): string {
  if (findings.length === 0) return incomplete ? INCOMPLETE_SUMMARY : "No known vulnerabilities\n";
  const lines = findings.map((f) => {
    const { line, character } = f.range.start;
    const [first, ...rest] = f.vulns;
    const more = rest.length > 0 ? `, +${rest.length} more` : "";
    const where = `${relative(cwd, fileURLToPath(f.uri))}:${line + 1}:${character + 1}`;
    return `${where}  ${f.severity}  ${f.name} ${f.current} → ${f.fix.target ?? "no fix"}  ${first?.id ?? ""}${more}${f.cached ? " (cached)" : ""}`;
  });
  const files = new Set(findings.map((f) => f.uri)).size;
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const breakdown = SEVERITY_ORDER.filter((s) => counts.has(s))
    .map((s) => `${counts.get(s)} ${s}`)
    .join(" · ");
  const summary = incomplete ? INCOMPLETE_SUMMARY : `${findings.length} vulnerable dependencies in ${files} files\n${breakdown}\n`;
  return `${lines.join("\n")}\n${summary}`;
}

interface TreeNode {
  label: string;
  children: TreeNode[];
}

/**
 * A `tree`-style listing: directories, then files, then each vulnerable dependency, then its advisories.
 * Plain Unicode box characters, no colour and one node per line, so it is easy to read and to grep.
 */
export function formatTree(findings: Finding[], cwd: string, incomplete = false): string {
  if (findings.length === 0) return incomplete ? INCOMPLETE_SUMMARY : "No known vulnerabilities\n";
  const root: TreeNode = { label: ".", children: [] };
  const child = (parent: TreeNode, label: string): TreeNode => {
    let node = parent.children.find((c) => c.label === label);
    if (!node) parent.children.push((node = { label, children: [] }));
    return node;
  };
  for (const f of findings) {
    let node = root;
    for (const segment of relative(cwd, fileURLToPath(f.uri)).split(sep)) node = child(node, segment);
    const dep = { label: `${f.name} ${f.current} → ${f.fix.target ?? "no fix"} [${f.severity}] (line ${f.range.start.line + 1})${f.cached ? " (cached)" : ""}`, children: [] as TreeNode[] };
    for (const v of f.vulns) {
      const cve = v.aliases.find((a) => a.startsWith("CVE-") && a !== v.id);
      dep.children.push({ label: `${v.id}${cve ? ` (${cve})` : ""} [${v.severity}]${v.summary ? ` ${v.summary}` : ""}`, children: [] });
    }
    node.children.push(dep);
  }
  const lines: string[] = [root.label];
  const walk = (node: TreeNode, prefix: string) => {
    node.children.forEach((c, i) => {
      const last = i === node.children.length - 1;
      lines.push(`${prefix}${last ? "└── " : "├── "}${c.label}`);
      walk(c, `${prefix}${last ? "    " : "│   "}`);
    });
  };
  walk(root, "");
  const files = new Set(findings.map((f) => f.uri)).size;
  return `${lines.join("\n")}\n\n${incomplete ? INCOMPLETE_SUMMARY : `${findings.length} vulnerable dependencies in ${files} files\n`}`;
}

/** Explicit paths, made absolute against cwd; those that are not manifests or lockfiles under cwd are dropped. */
function matchingPaths(paths: string[], cwd: string): string[] {
  return paths.map((p) => resolve(cwd, p)).filter((abs) => {
    const rel = relative(cwd, abs);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
    return classifyFile(rel.split(sep).join("/"), ALL_MODULES) !== undefined;
  });
}

/** Runs osv-check and returns its exit code; never throws. */
export async function runCheck(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "min-severity": { type: "string", default: "low" },
        "only-fixable": { type: "boolean", default: false },
        format: { type: "string", default: "text" },
        strict: { type: "boolean", default: false },
        "no-lockfiles": { type: "boolean", default: false },
        "disable-ecosystem": { type: "string", multiple: true },
        ignore: { type: "string", multiple: true },
        "cache-dir": { type: "string" },
        "cache-ttl-hours": { type: "string" },
        "api-base-url": { type: "string" },
        "ca-certificate-path": { type: "string" },
        help: { type: "boolean", default: false },
        version: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    io.stderr(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (values.version) {
    io.stdout(`${pkg.version}\n`);
    return 0;
  }
  const minSeverity = values["min-severity"] as string;
  const format = values.format as string;
  if (!SEVERITY_LEVELS.includes(minSeverity) || !FORMATS.includes(format)) {
    io.stderr(`invalid value for --${SEVERITY_LEVELS.includes(minSeverity) ? "format" : "min-severity"}\n${USAGE}`);
    return 2;
  }
  const known = ALL_MODULES.map((m) => m.id);
  const disabled = values["disable-ecosystem"] ?? [];
  const unknown = disabled.find((id) => !known.includes(id));
  if (unknown !== undefined) {
    io.stderr(`unknown ecosystem "${unknown}" for --disable-ecosystem (one of: ${known.join(", ")})\n`);
    return 2;
  }
  const ttl = values["cache-ttl-hours"] === undefined ? DEFAULT_SETTINGS.cacheTtlHours : Number(values["cache-ttl-hours"]);
  if (!Number.isFinite(ttl) || ttl < 1) {
    io.stderr(`invalid value for --cache-ttl-hours (a number, minimum 1)\n${USAGE}`);
    return 2;
  }

  try {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      minimumSeverity: minSeverity as MinimumSeverity,
      onlyShowFixable: values["only-fixable"],
      scanLockfiles: !values["no-lockfiles"],
      ecosystems: Object.fromEntries(disabled.map((id) => [id, false])),
      ignoredVulnerabilities: values.ignore ?? [],
      cacheTtlHours: ttl,
      caCertificatePath: values["ca-certificate-path"] ?? DEFAULT_SETTINGS.caCertificatePath,
      apiBaseUrl: values["api-base-url"]?.replace(/\/+$/, "") || DEFAULT_SETTINGS.apiBaseUrl,
    };
    const cwd = io.cwd;
    const client = new OsvClient({ baseUrl: settings.apiBaseUrl, userAgent: USER_AGENT, dispatcher: createDispatcher(settings.caCertificatePath, io.env) });
    const service = new OsvService(client, new DiskCache(values["cache-dir"] ?? defaultCacheDir(process.platform, io.env)), () => settings.cacheTtlHours);

    // Offline lookups return no result for a package with no cached entry.
    let incomplete = false;
    const osv: ScanContext["osv"] = {
      lookup: async (queries, signal) => {
        const outcome = await service.lookup(queries, signal);
        if (outcome.offline && outcome.results.size < new Set(queries.map((q) => `${q.ecosystem}|${q.name}|${q.version}`)).size) incomplete = true;
        return outcome;
      },
    };

    const warn = (path: string, message: string) => io.stderr(`warning: could not check ${relative(cwd, path) || "."}: ${message}\n`);
    const paths = positionals.length > 0 ? matchingPaths(positionals, cwd) : await discoverFiles(cwd, ALL_MODULES, { onError: warn });

    // Each file is governed by its nearest osv-scanner.toml, so files are scanned in one batch per toml.
    const byToml = new Map<string | undefined, string[]>();
    for (const path of paths) {
      const toml = await findOsvScannerToml(path, cwd, nodeFileSource);
      byToml.set(toml, [...(byToml.get(toml) ?? []), path]);
    }

    const findings: Finding[] = [];
    let offline = false;
    for (const [toml, group] of byToml) {
      const entries = toml ? parseOsvScannerToml((await nodeFileSource.read(toml)) ?? "") : [];
      const ctx: ScanContext = {
        files: nodeFileSource,
        osv,
        settings,
        ignores: new IgnoreMatcher(settings.ignoredVulnerabilities, entries, new Date()),
        rootDir: cwd,
        log: (m) => io.stderr(`warning: ${m}\n`),
      };
      const result = await scanFiles(group, ctx);
      findings.push(...result.findings);
      offline ||= result.offline;
      for (const e of result.parseErrors) warn(e.path, e.message);
    }
    findings.sort((a, b) => a.uri.localeCompare(b.uri) || a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);

    io.stdout(format === "json" ? `${JSON.stringify({ findings, offline }, null, 2)}\n` : format === "tree" ? formatTree(findings, cwd, incomplete) : formatText(findings, cwd, incomplete));
    if (incomplete) {
      io.stderr(OFFLINE_WARNING);
      if (values.strict) return 2;
    }
    return findings.length > 0 ? 1 : 0;
  } catch (e) {
    io.stderr(`error: ${(e as Error).message}\n`);
    return 2;
  }
}
