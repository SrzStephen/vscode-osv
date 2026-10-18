import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Contents of a committed manifest fixture under test/fixtures/pypi. */
export const read = (file: string) => readFileSync(join(__dirname, "..", "fixtures", "pypi", file), "utf8");
