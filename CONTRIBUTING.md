# Contributing

With [`just`](https://github.com/casey/just) installed, `just check` runs the same gate as CI
on every platform, `just ci` runs all of CI, and `just --list` shows the other recipes. The
commands below are what they wrap.

```sh
npm ci
npm run lint && npm run typecheck && npm test && npm run build
npm run test:integration -w vscode-osv   # needs a display (xvfb-run -a on Linux)
npm run test:canary                      # live api.osv.dev check; not part of `npm test`
```

## Release checklist

Nothing is published automatically from a branch; publishing happens only from the
`release.yml` workflow, on a pushed `v*` tag. Apart from the one-time npm bootstrap below,
never run `vsce publish`, `ovsx publish` or `npm publish` by hand.

### Open decisions (spec section 18) - resolve before the first release

- [x] GitHub repo: `SrzStephen/vscode-osv`. It is used in the pre-commit `repo:` URL in the
      docs and in the packages' `repository` fields.
- [ ] Choose the Marketplace publisher ID (`<marketplace-publisher>`) and set `publisher` in
      `packages/vscode-osv/package.json` (currently the placeholder `osv-vscode`).
- [ ] Decide on the npm package name/scope for `osv-language-server`, remove `"private": true`
      from `packages/osv-language-server/package.json`, and add `repository` (needed for
      `--provenance`). (`license` and the LICENSE files are done.)
- [ ] Set up OIDC publishing (no long-lived `VSCE_PAT` or `NPM_TOKEN`):
  - Create a GitHub environment named `release` (optionally with required reviewers). The
    publish job runs in it.
  - **npm:** publish `osv-language-server` once by hand to create the package (use a
    short-lived token and revoke it afterwards; this is the only manual publish), then on
    npmjs.com open the package's Settings > Trusted Publisher and enter the GitHub org/repo,
    workflow `release.yml` and environment `release`.
  - **VS Code Marketplace:** register a Microsoft Entra app, add a federated credential with
    subject `repo:SrzStephen/vscode-osv:environment:release`, and add its service principal as
    a Contributor on the Marketplace publisher (Members page). Save the app's client ID and
    tenant ID as the `release` environment variables `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`
    (they are not secrets).
  - **Open VSX** (open-vsx.org) has no OIDC, so it uses a token:
    1. Sign in with GitHub, link an Eclipse Foundation account and sign the Publisher
       Agreement (publishing is refused without it).
    2. Create an access token under your profile's Settings > Access Tokens.
    3. Create the namespace once, matching `publisher` in `packages/vscode-osv/package.json`:
       `npx ovsx create-namespace <publisher> -p <token>`. Optionally claim ownership of it
       through the Open VSX GitHub issue process so it shows as verified.
    4. Store the token as the `release` environment secret `OVSX_PAT`.
- [ ] Replace the placeholder `packages/vscode-osv/icon.png` with the real icon.

### Each release

1. Record the README GIFs / screenshots.
2. Update `packages/vscode-osv/CHANGELOG.md`.
3. `npm run release:prepare -- X.Y.Z` bumps both packages' versions and the
   `osv-language-server@X.Y.Z` pin in `.pre-commit-hooks.yaml` (it validates `X.Y.Z` and
   edits files only). Then run `npm install` to refresh `package-lock.json`.
4. Review `git diff`, run the verification commands above, commit.
5. `git tag vX.Y.Z && git push origin main vX.Y.Z`. The release workflow re-runs all checks,
   then publishes to the Marketplace, Open VSX and npm and attaches the VSIX to a GitHub release.
