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
`release.yml` workflow, started manually from the Actions tab. Apart from the one-time npm bootstrap below,
never run `vsce publish`, `ovsx publish` or `npm publish` by hand.

### Open decisions (spec section 18) - resolve before the first release

- [x] GitHub repo: `SrzStephen/vscode-osv`. It is used in the pre-commit `repo:` URL in the
      docs and in the packages' `repository` fields.
- [x] Marketplace publisher ID is `srzstephen` (set in `packages/vscode-osv/package.json`).
      Create that publisher on the Marketplace and the same namespace on Open VSX.
- [x] npm package `osv-language-server` (unscoped; name was free when checked). `private` is
      removed and `repository` and `license` are set.
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
- [x] Icon replaced (`packages/vscode-osv/icon.png`).

### Each release

1. Re-record the README media if the UI changed:
   - `docs/media/editor.gif`: `npm run build -w packages/vscode-osv`, then `scripts/record-demo/record.sh`
     (runs the real extension on a private virtual display; needs `code`, `xvfb-run`, `ffmpeg`, `python3`, network).
   - `docs/media/cli.svg`: in a demo project run `osv-check --min-severity high > out.txt`, then
     `node --import tsx scripts/render-cli-svg.ts out.txt "osv-check --min-severity high" demo-app > docs/media/cli.svg`.
2. Make sure `packages/vscode-osv/CHANGELOG.md` has the release's entries under `## Unreleased`
   (the release fails if that section is empty) and everything is merged to `main`.
3. In GitHub go to Actions > Release > Run workflow, on `main`, and enter the bump: `patch`,
   `minor`, `major`, or an explicit `X.Y.Z`. The workflow bumps both packages' versions and the
   `osv-language-server@X.Y.Z` pin in `.pre-commit-hooks.yaml`, renames `## Unreleased` to the
   new version, refreshes `package-lock.json` and re-runs all checks. It then commits the bump
   to `main`, tags `vX.Y.Z`, publishes to the Marketplace, Open VSX and npm and attaches the
   VSIX to a GitHub release.

The same bump can be previewed locally with `npm run release:prepare -- minor` (it edits files
only; discard the changes afterwards). The workflow pushes to `main` with `GITHUB_TOKEN`, so if
branch protection is enabled on `main`, allow the `github-actions` bot to bypass it.
