# Publishing boundary

This is the public publishing repository for the npm package
[`@millwork/solver`](https://www.npmjs.com/package/@millwork/solver). It holds
the prepared export of the package plus the pinned publishing workflow, and
nothing else. The package's engineering source is maintained elsewhere,
privately; this repository is not a mirror of that source and does not accept
source contributions.

**This repository does not take issues or support requests.**

## Prepared export

The tree is a prepared export for the next candidate version, derived from
the published, immutable `@millwork/solver@0.1.0` registry artifact:

- documentation comments were sanitized to remove references to files that do
  not ship in the package;
- package metadata was corrected — a description matching the implemented
  behavior, and `repository` pointing at this repository;
- the version advanced to `0.1.1`, because published versions are immutable
  and are never republished.

Derivation and review evidence are retained privately. `files: ["dist"]`
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

- `scripts/check-packed-files.mjs` — the packed file set must equal exactly
  the committed, reviewed `dist/` tree plus the three files npm always
  includes, and the manifest must tell the truth about this repository
  (name, stable version, `repository`, `files`, no forced provenance, the
  reviewed scripts set). The packed artifact is the reviewed candidate;
  this check is never satisfied by editing the manifest to match.
- `scripts/smoke-installed.mjs` — packs the tree, installs the tarball into
  a clean directory on Node 20 and 22, and proves the public surface
  imports and constructs with no import-time network access.
- `scripts/verify-token-absence.sh` + `scripts/test-token-absence-real-npm.sh`
  — the fail-closed npm credential inspection, exercised against the real
  pinned npm 11.5.1 (a clean environment and the inert setup-node
  placeholder pass; literal tokens, populated environment references, and
  failing inspections refuse). The inspection is standalone tooling here:
  wiring it into `publish.yml` is deliberately NOT done — `publish.yml` is
  the bound trusted-publishing workflow, and modifying it invalidates the
  binding proof; any such wiring is a separate, explicitly reviewed change
  after the proof-publish.
- pinned, checksum-verified actionlint over the workflows.

CI never dispatches the publish workflow and never publishes.

## Publishing

Publishing happens only through
[`.github/workflows/publish.yml`](.github/workflows/publish.yml):

- **Operator dispatch only** (`workflow_dispatch`) against the protected
  `npm-publish` environment. The operator must create and protect that
  environment (required reviewers) before the first dispatch; a dispatch is
  itself an operator gate.
- **npm trusted publishing (OIDC)** with provenance. The workflow has
  `id-token: write` and no npm token anywhere; it cannot publish until the
  operator configures the npm-side trusted publisher for
  `millworkdev/solver` / `publish.yml` / environment `npm-publish`.
- **Pinned toolchain**: GitHub-hosted `ubuntu-24.04`, Node `22.14.0`,
  npm CLI `11.5.1`.
- **Immutable-version discipline**: the workflow refuses to run if the
  `package.json` version already exists on the registry, refuses the `latest`
  dist-tag, and publishes under an explicit non-default tag (default
  `candidate`). `latest` is never moved by this workflow.
