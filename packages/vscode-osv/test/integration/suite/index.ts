import Mocha from "mocha";
import { join } from "node:path";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30_000 });
  mocha.addFile(join(__dirname, "smoke.test.js"));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} integration test(s) failed`)) : resolve()));
  });
}
