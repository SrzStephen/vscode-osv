export type MinimumSeverity = "low" | "medium" | "high" | "critical";
export type OfferLockCommand = "ask" | "always" | "never";

export interface Settings {
  enable: boolean;
  ecosystems: Record<string, boolean>;
  minimumSeverity: MinimumSeverity;
  scanLockfiles: boolean;
  scanWorkspaceOnStartup: boolean;
  cacheTtlHours: number;
  apiBaseUrl: string;
  caCertificatePath: string;
  ignoredVulnerabilities: string[];
  offerLockCommand: OfferLockCommand;
}

export const DEFAULT_SETTINGS: Settings = {
  enable: true,
  ecosystems: {},
  minimumSeverity: "low",
  scanLockfiles: true,
  scanWorkspaceOnStartup: false,
  cacheTtlHours: 48,
  apiBaseUrl: "https://api.osv.dev",
  caCertificatePath: "",
  ignoredVulnerabilities: [],
  offerLockCommand: "ask",
};

const SEVERITIES: readonly string[] = ["low", "medium", "high", "critical"];
const LOCK_MODES: readonly string[] = ["ask", "always", "never"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Coerces untrusted configuration into Settings; unknown keys are dropped and bad values fall back to defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

  const ecosystems: Record<string, boolean> = {};
  if (isRecord(r.ecosystems)) {
    for (const [k, v] of Object.entries(r.ecosystems)) if (typeof v === "boolean") ecosystems[k] = v;
  }

  const ttl = typeof r.cacheTtlHours === "number" && Number.isFinite(r.cacheTtlHours) ? Math.max(1, r.cacheTtlHours) : d.cacheTtlHours;
  const apiBaseUrl = typeof r.apiBaseUrl === "string" && r.apiBaseUrl.trim() !== "" ? r.apiBaseUrl.trim().replace(/\/+$/, "") : d.apiBaseUrl;
  const caCertificatePath = typeof r.caCertificatePath === "string" ? r.caCertificatePath.trim() : d.caCertificatePath;

  return {
    enable: bool(r.enable, d.enable),
    ecosystems,
    minimumSeverity: typeof r.minimumSeverity === "string" && SEVERITIES.includes(r.minimumSeverity) ? (r.minimumSeverity as MinimumSeverity) : d.minimumSeverity,
    scanLockfiles: bool(r.scanLockfiles, d.scanLockfiles),
    scanWorkspaceOnStartup: bool(r.scanWorkspaceOnStartup, d.scanWorkspaceOnStartup),
    cacheTtlHours: ttl,
    apiBaseUrl,
    caCertificatePath,
    ignoredVulnerabilities: Array.isArray(r.ignoredVulnerabilities) ? r.ignoredVulnerabilities.filter((x): x is string => typeof x === "string") : [],
    offerLockCommand: typeof r.offerLockCommand === "string" && LOCK_MODES.includes(r.offerLockCommand) ? (r.offerLockCommand as OfferLockCommand) : d.offerLockCommand,
  };
}

/** A missing key means enabled. */
export function isEcosystemEnabled(s: Settings, moduleId: string): boolean {
  return s.ecosystems[moduleId] ?? true;
}
