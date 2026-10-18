import { runCheck } from "./cli.js";

void runCheck(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  env: process.env,
}).then((code) => {
  process.exit(code);
});
