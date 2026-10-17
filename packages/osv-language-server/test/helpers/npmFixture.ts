import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Contents of a committed lockfile fixture under test/fixtures/npm. */
export const read = (file: string) => readFileSync(join(__dirname, "..", "fixtures", "npm", file), "utf8");
