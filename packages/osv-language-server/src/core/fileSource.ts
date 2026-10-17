import { promises as fs } from "node:fs";

/** Abstracts file reads so callers can be tested without touching disk. */
export interface FileSource {
  /** Resolves undefined when the path does not exist or is a directory. */
  read(path: string): Promise<string | undefined>;
}

export const nodeFileSource: FileSource = {
  async read(path) {
    try {
      return await fs.readFile(path, "utf8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") return undefined;
      throw e;
    }
  },
};
