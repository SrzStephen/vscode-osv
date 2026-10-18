import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import picomatch from "picomatch";
import { classifyFile } from "../ecosystems/index.js";
import type { EcosystemModule } from "../ecosystems/types.js";
import { queryKey } from "./osvService.js";
import { prepareDocument, type PreparedScan, type ScanContext } from "./scanner.js";
import type { Finding, PackageQuery } from "./types.js";

const SKIPPED_DIRS = new Set(["node_modules", "target", "vendor", ".git", "dist", "build", ".venv", "venv", "__pycache__"]);

/** Finds every manifest and lockfile under rootDir, as absolute paths. */
export async function discoverFiles(rootDir: string, modules: EcosystemModule[], opts: { exclude?: string[] } = {}): Promise<string[]> {
  // gitignore-style: a pattern without "/" matches that name at any depth; one with "/" is anchored to the root.
  const isExcluded = picomatch(
    (opts.exclude ?? []).map((g) => (g.includes("/") ? g : `**/${g}`)),
    { dot: true },
  );
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(rootDir, path).split(sep).join("/");
      if (isExcluded(rel)) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(path);
      } else if (entry.isFile() && classifyFile(rel, modules)) {
        found.push(path);
      }
    }
  }

  await walk(rootDir);
  return found;
}

export interface WorkspaceScanResult {
  findings: Finding[];
  offline: boolean;
  /** Files that could not be read or parsed, so a corrupt manifest does not look clean. */
  parseErrors: { path: string; message: string }[];
}

/** Scans many files with a single batched OSV lookup. */
export async function scanFiles(paths: string[], ctx: ScanContext): Promise<WorkspaceScanResult> {
  const prepared: PreparedScan[] = [];
  const parseErrors: WorkspaceScanResult["parseErrors"] = [];
  for (const path of paths) {
    const text = await ctx.files.read(path);
    if (text === undefined) {
      parseErrors.push({ path, message: "unreadable" });
      continue;
    }
    const scan = await prepareDocument(pathToFileURL(path).href, path, text, ctx);
    if (!scan) continue;
    if ("parseError" in scan) parseErrors.push({ path, message: "failed to parse" });
    else prepared.push(scan);
  }

  const queries = new Map<string, PackageQuery>();
  for (const scan of prepared) {
    for (const q of scan.queries) queries.set(queryKey(q), q);
  }
  if (queries.size === 0) return { findings: [], offline: false, parseErrors };

  const outcome = await ctx.osv.lookup([...queries.values()]);
  return { findings: prepared.flatMap((scan) => scan.finalize(outcome.results)), offline: outcome.offline, parseErrors };
}
