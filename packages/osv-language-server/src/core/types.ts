export type Severity = "critical" | "high" | "medium" | "low" | "unknown";

export interface Position {
  line: number;
  character: number;
}

export interface TextRange {
  start: Position;
  end: Position;
}

export type DepKind = "registry" | "git" | "path" | "url" | "unresolved";

/** A dependency declared in a manifest. */
export interface DeclaredDep {
  /** Ecosystem-normalized name. */
  name: string;
  /** e.g. "^1.2.3", ">=2.0,<3"; undefined if no version. */
  rawSpec?: string | undefined;
  nameRange: TextRange;
  specRange?: TextRange | undefined;
  /** Derived from rawSpec; undefined if unresolvable. */
  lowerBound?: string | undefined;
  /** Only "registry" is checked. */
  kind: DepKind;
  /** e.g. "devDependencies", "dev", "test". */
  group?: string;
  /** Where the version text lives when it is not inline (a property in the same file, or another file). */
  specLocation?: { path: string; range: TextRange; rawSpec: string };
}

/** A dependency resolved in a lockfile. */
export interface ResolvedDep {
  name: string;
  version: string;
  /** Squiggle location (the version, else the entry). */
  range: TextRange;
  direct: boolean;
  /** Dependency path from a direct dep, when derivable. */
  via?: string[];
  /** Specs a lockfile entry was resolved for, e.g. yarn key `lodash@^4.17.15` gives ["^4.17.15"]. */
  requestedSpecs?: string[];
}

export type OsvEvent =
  | { introduced: string }
  | { fixed: string }
  | { last_affected: string }
  | { limit: string };

export interface OsvRange {
  type: "SEMVER" | "ECOSYSTEM" | "GIT";
  events: OsvEvent[];
}

export interface OsvAffected {
  package?: { ecosystem: string; name: string };
  ranges?: OsvRange[];
  versions?: string[];
}

export interface OsvRecord {
  id: string;
  modified: string;
  withdrawn?: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: { type: string; score: string }[];
  affected?: OsvAffected[];
  database_specific?: Record<string, unknown>;
}

/** A merged alias group. */
export interface Vuln {
  /** Preferred ID (GHSA > ecosystem-native > CVE). */
  id: string;
  aliases: string[];
  summary: string;
  severity: Severity;
  modified: string;
}

export interface FixResult {
  /** undefined means no fix available. */
  target: string | undefined;
  fixesAll: boolean;
  crossesMajor: boolean;
  reason?: "no-fixed-event" | "unparseable-version" | "no-matching-range";
}

export interface TextEditSpec {
  uri: string;
  range: TextRange;
  newText: string;
}

export interface UpdatePlan {
  /** Manifest edit(s). */
  edit: TextEditSpec[];
  lockCommand?: { cwd: string; command: string };
  kind: "direct" | "override" | "command-only";
  /** True when the edit widens the declared range. */
  widened?: boolean;
}

/** Also the JSON schema for osv.getFindings, osv.scanWorkspace and osv-check --format json. */
export interface Finding {
  /** Stable identity key for the finding. */
  key: string;
  uri: string;
  range: TextRange;
  /** OSV ecosystem name. */
  ecosystem: string;
  name: string;
  current: string;
  /** True if current is the declared lower bound rather than a locked version. */
  checkedLowerBound: boolean;
  source: "manifest" | "lockfile";
  direct: boolean;
  via?: string[];
  /** After ignores and severity filter. */
  vulns: Vuln[];
  /** Max over vulns. */
  severity: Severity;
  fix: FixResult;
  /** Absent when no fix or no edit possible. */
  update?: UpdatePlan;
  /** True if served from stale cache while offline. */
  cached: boolean;
}

export interface PackageQuery {
  ecosystem: string;
  name: string;
  version: string;
}
