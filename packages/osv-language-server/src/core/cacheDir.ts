import { homedir } from "node:os";
import { join } from "node:path";

const NAME = "osv-language-server";

export function defaultCacheDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (env.OSV_CACHE_DIR) return env.OSV_CACHE_DIR;
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), NAME, "Cache");
  if (platform === "darwin") return join(home, "Library", "Caches", NAME);
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), NAME);
}
