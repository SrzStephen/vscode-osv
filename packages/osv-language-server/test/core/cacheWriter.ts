// Child process for the concurrent-writer test in cache.test.ts.
import { DiskCache } from "../../src/core/cache.js";

async function main(): Promise<void> {
  const [dir, tag] = process.argv.slice(2);
  const cache = new DiskCache(dir!);
  const q = { ecosystem: "npm", name: "lodash", version: "4.17.0" };
  for (let i = 0; i < 50; i++) {
    await cache.putPackage(q, { fetchedAt: new Date().toISOString(), vulnIds: [{ id: `${tag}-${i}`, modified: "2024-01-01T00:00:00Z" }] });
  }
}

void main();
