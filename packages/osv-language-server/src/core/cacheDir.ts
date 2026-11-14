import { homedir } from "node:os";
import { posix, win32 } from "node:path";

const NAME = "osv-language-server";

/** Where the disk cache lives. Paths follow the requested platform's conventions, whatever the host OS is. */
export function defaultCacheDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (env.OSV_CACHE_DIR) return env.OSV_CACHE_DIR;
  const { join } = platform === "win32" ? win32 : posix;
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), NAME, "Cache");
  if (platform === "darwin") return join(home, "Library", "Caches", NAME);
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), NAME);
}
