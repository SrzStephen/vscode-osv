import { promises as fs } from "node:fs";

/** Abstracts file reads so callers can be tested without touching disk. */
export interface FileSource {
  /** Resolves undefined when the path does not exist or is a directory. */
  read(path: string): Promise<string | undefined>;
}

/** Open-document text wins over disk, so unsaved edits are what gets analyzed. */
export function overlayFileSource(open: (path: string) => string | undefined, base: FileSource): FileSource {
  return {
    async read(path) {
      return open(path) ?? base.read(path);
    },
  };
}

/** Reads UTF-8 from disk, dropping a leading BOM as editors do, so positions match the editor's. */
export const nodeFileSource: FileSource = {
  async read(path) {
    try {
      const text = await fs.readFile(path, "utf8");
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") return undefined;
      throw e;
    }
  },
};
