import pkg from "../../package.json";

/** User-Agent sent on every OSV request by both the language server and osv-check. */
export const USER_AGENT = `osv-language-server/${pkg.version}`;
