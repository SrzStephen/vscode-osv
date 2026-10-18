import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { startServer } from "./server.js";

/** `--cache-dir <dir>` or `--cache-dir=<dir>`. */
function cacheDirArg(argv: string[]): string | undefined {
  for (const [i, arg] of argv.entries()) {
    if (arg === "--cache-dir") return argv[i + 1];
    if (arg.startsWith("--cache-dir=")) return arg.slice("--cache-dir=".length);
  }
  return undefined;
}

// createConnection picks stdio or node-ipc from --stdio / --node-ipc in process.argv.
const cacheDir = cacheDirArg(process.argv.slice(2));
startServer(createConnection(ProposedFeatures.all), cacheDir ? { cacheDir } : {});
