import type { Finding } from "../core/types.js";

/** Latest findings per document URI. */
export class FindingStore {
  private readonly byUri = new Map<string, Finding[]>();

  set(uri: string, findings: Finding[]): void {
    this.byUri.set(uri, findings);
  }

  get(uri: string): Finding[] {
    return this.byUri.get(uri) ?? [];
  }

  byKey(uri: string, key: string): Finding | undefined {
    return this.get(uri).find((f) => f.key === key);
  }

  all(): Finding[] {
    return [...this.byUri.values()].flat();
  }

  delete(uri: string): void {
    this.byUri.delete(uri);
  }
}
