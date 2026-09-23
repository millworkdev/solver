# Publishing boundary

This is the public publishing repository for the npm package
[`@millwork/solver`](https://www.npmjs.com/package/@millwork/solver). It holds
the prepared export of the package plus the pinned publishing workflow, and
nothing else. The package's engineering source is maintained elsewhere,
privately; this repository is not a mirror of that source and does not accept
source contributions.

**This repository does not take issues or support requests.**

## Prepared export

The tree is a prepared export for release version `0.1.17`, generated from
the exact reviewed SDK build:

- the closed export contains exactly 84 compiled JavaScript and declaration
  files, including `dist/cli.js` and every runtime module it imports, plus 15
  maintained kit assets under `dist/kit/`;
- source maps are excluded and map-reference comments are stripped because the
  private source tree is not published here;
- documentation comments and user-facing wording are sanitized by the reviewed,
  deterministic export recipe;
- `export-manifest.json` binds every emitted file by SHA-256 and records the
  aggregate digest formula;
- package metadata exposes `millwork` at `dist/cli.js` and points `repository`
  at this exact publishing proxy;
- the version advanced to `0.1.17`; immutable `0.1.0` through `0.1.3`, `0.1.5`,
  `0.1.6`, `0.1.7`, `0.1.8`, `0.1.9`, `0.1.10`, `0.1.11`, `0.1.12`, `0.1.13`, `0.1.14`, `0.1.15` and `0.1.16` are never republished or altered, and `0.1.4` remains unused
  because it was reserved by the release drill plan.

Derivation and review evidence are retained privately.
[`scripts/check-export-manifest.mjs`](scripts/check-export-manifest.mjs)
recomputes every file hash and the aggregate digest. `files: ["dist"]`
keeps repository-only files (this document, `scripts/`, `.github/`) out of
every packed artifact; npm always includes `package.json`, `README.md`, and
`LICENSE`.

`scripts/check-public-content.mjs` deterministically scans the packed file
set and every repository-only file against the export content rules, and
[`.github/workflows/content-check.yml`](.github/workflows/content-check.yml)
runs it on every pull request and push to `main`.

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) adds the guard set
this repository shares with the sibling MCP publishing repository, also on
every pull request and push to `main`:

- `scripts/check-export-manifest.mjs` — every `dist/` byte and the exact
  closed-world file set must match the committed export manifest.
- `scripts/check-packed-files.mjs` — the packed file set must equal exactly
  that export plus the three files npm always includes, and the manifest must
  bind version `0.1.17` and `millwork` to the exported `dist/cli.js`.
- `scripts/smoke-installed.mjs` — packs the tree, installs the tarball into
  a clean directory on Node 20 and 22, proves the public module imports, runs
  the installed `millwork` executable, verifies the exact `0.1.17` package and
  its current-docs link, and exercises the public docs command without network
  access. The immutable binary does not assert mutable public support status.
- `scripts/verify-token-absence.sh` + `scripts/test-token-absence-real-npm.sh`
  — the fail-closed npm credential inspection, exercised against the real
  pinned npm 11.5.1 (a clean environment and the inert setup-node
  placeholder pass; literal tokens, populated environment references, and
  failing inspections refuse). The publish precondition guard runs this inspection before checking
  that the accepted version is absent from the registry.
- pinned, checksum-verified actionlint over the workflows.

CI never dispatches the publish workflow and never publishes.

## Publishing

Publishing happens only through
[`.github/workflows/publish.yml`](.github/workflows/publish.yml):

- **Manual dispatch** (`workflow_dispatch`) by the release manager after
  the operator accepts the release. Both packages require `expected-version`
  and `dist-tag` (default `latest`). The protected `npm-publish` environment
  still requires human approval before publication.
- **npm trusted publishing (OIDC)** with provenance. The workflow has
  `id-token: write` and no npm token anywhere; it cannot publish until the
  operator configures the npm-side trusted publisher for
  `millworkdev/solver` / `publish.yml` / environment `npm-publish`.
- **Pinned toolchain**: GitHub-hosted `ubuntu-24.04`, Node `22.14.0`,
  npm CLI `11.5.1`.
- **Immutable-version discipline**: the workflow refuses to run if the
  `package.json` version already exists on the registry or differs from
  `expected-version`. Only a definitive E404 may proceed. Tags must match
  the workflow pattern and cannot start with a number. For the accepted release, set `dist-tag`
  to `latest`. Publishing under `latest` leaves existing `candidate` tags on
  their prior versions. Provenance and the token refusal remain required.
