import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pkg from "../package.json";
import { DiskCache } from "./core/cache.js";
import { defaultCacheDir } from "./core/cacheDir.js";
import { nodeFileSource } from "./core/fileSource.js";
import { findOsvScannerToml, IgnoreMatcher, parseOsvScannerToml } from "./core/ignores.js";
import { OsvClient } from "./core/osvClient.js";
import { OsvService } from "./core/osvService.js";
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
  --min-severity <level>  low|medium|high|critical (default: low)
  --format <format>       text|json (default: text)
  --strict                exit 2 if osv.dev is unreachable and nothing is cached
  --no-lockfiles          skip lockfile entries
  --cache-dir <dir>       override the cache location
  --api-base-url <url>    override the OSV API base URL
  --help                  show this help
  --version               show the version

Exit codes: 0 no findings, 1 findings, 2 usage error or network failure under --strict.
`;

const SEVERITY_LEVELS: readonly string[] = ["low", "medium", "high", "critical"];
const FORMATS: readonly string[] = ["text", "json"];
const OFFLINE_WARNING = "warning: osv.dev unreachable and no cached data; results incomplete\n";
const USER_AGENT = "osv-check";

/** One line per finding plus a summary line, or "No known vulnerabilities". */
export function formatText(findings: Finding[], cwd: string): string {
  if (findings.length === 0) return "No known vulnerabilities\n";
  const lines = findings.map((f) => {
    const { line, character } = f.range.start;
    const [first, ...rest] = f.vulns;
    const more = rest.length > 0 ? `, +${rest.length} more` : "";
    const where = `${relative(cwd, fileURLToPath(f.uri))}:${line + 1}:${character + 1}`;
    return `${where}  ${f.severity}  ${f.name} ${f.current} → ${f.fix.target ?? "no fix"}  ${first?.id ?? ""}${more}`;
  });
  const files = new Set(findings.map((f) => f.uri)).size;
  return `${lines.join("\n")}\n${findings.length} vulnerable dependencies in ${files} files\n`;
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
        format: { type: "string", default: "text" },
        strict: { type: "boolean", default: false },
        "no-lockfiles": { type: "boolean", default: false },
        "cache-dir": { type: "string" },
        "api-base-url": { type: "string" },
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

  try {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      minimumSeverity: minSeverity as MinimumSeverity,
      scanLockfiles: !values["no-lockfiles"],
      apiBaseUrl: values["api-base-url"]?.replace(/\/+$/, "") || DEFAULT_SETTINGS.apiBaseUrl,
    };
    const cwd = io.cwd;
    const client = new OsvClient({ baseUrl: settings.apiBaseUrl, userAgent: USER_AGENT });
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

    const paths = positionals.length > 0 ? matchingPaths(positionals, cwd) : await discoverFiles(cwd, ALL_MODULES);

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
      const ctx: ScanContext = { files: nodeFileSource, osv, settings, ignores: new IgnoreMatcher([], entries, new Date()), rootDir: cwd };
      const result = await scanFiles(group, ctx);
      findings.push(...result.findings);
      offline ||= result.offline;
      for (const e of result.parseErrors) io.stderr(`warning: could not check ${relative(cwd, e.path)}: ${e.message}\n`);
    }
    findings.sort((a, b) => a.uri.localeCompare(b.uri) || a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);

    io.stdout(format === "json" ? `${JSON.stringify({ findings, offline }, null, 2)}\n` : formatText(findings, cwd));
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
