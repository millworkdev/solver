// The packed artifact must contain exactly the committed, reviewed file set,
// and the manifest must tell the truth about this repository. The committed
// tree is the review boundary: every packed file must be a git-tracked
// `dist/` file (only `.js`, `.d.ts`, `.js.map` extensions) or one of the
// three files npm always includes. Runs `npm pack --dry-run --json` (no
// tarball is written) and fails closed on any drift.
//
// The manifest is pinned to the reviewed candidate's exact shape. This
// check must never be satisfied by editing the packed manifest to match --
// the packed artifact is the reviewed T6 candidate, and changing it
// invalidates that review.
//
// Run: node scripts/check-packed-files.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const trackedDistFiles = execFileSync("git", ["ls-files", "dist"], { cwd: repositoryRoot, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
for (const path of trackedDistFiles) {
  if (!/\.(?:js|d\.ts|js\.map)$/.test(path)) {
    failures.push(`tracked dist file with an unapproved extension: ${path}`);
  }
}
const allowedPackedFiles = ["LICENSE", "README.md", "package.json", ...trackedDistFiles].sort();

const packOutput = JSON.parse(execFileSync(
  "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
));
const packedFiles = packOutput[0].files.map((file) => file.path).sort();

if (JSON.stringify(packedFiles) !== JSON.stringify(allowedPackedFiles)) {
  const extra = packedFiles.filter((file) => !allowedPackedFiles.includes(file));
  const missing = allowedPackedFiles.filter((file) => !packedFiles.includes(file));
  if (extra.length > 0) failures.push(`packed files outside the committed set: ${extra.join(", ")}`);
  if (missing.length > 0) failures.push(`committed files missing from the pack: ${missing.join(", ")}`);
}

const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
if (manifest.name !== "@millwork/solver") failures.push(`manifest name is ${manifest.name}`);
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
  failures.push(`manifest version ${manifest.version} is not stable SemVer`);
}
if (manifest.version === "0.1.0") failures.push("manifest version regressed to the immutable bootstrap version 0.1.0");
if (manifest.repository?.url !== "git+https://github.com/millworkdev/solver.git") {
  failures.push(`manifest repository does not name this exact public repository: ${manifest.repository?.url}`);
}
if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) {
  failures.push(`manifest files must be exactly ["dist"], got ${JSON.stringify(manifest.files)}`);
}
if (manifest.publishConfig?.access !== "public") failures.push("manifest publishConfig.access must be public");
if (manifest.publishConfig?.provenance !== undefined) {
  failures.push("manifest must not force provenance; it comes from trusted publishing at publish time");
}
if (manifest.bin !== undefined) failures.push("this package ships no binary; a bin entry is drift");
// The reviewed candidate's scripts, exactly; any change is a manifest change
// to the reviewed artifact and needs its own review.
const reviewedScriptNames = ["build", "test"];
if (JSON.stringify(Object.keys(manifest.scripts ?? {}).sort()) !== JSON.stringify(reviewedScriptNames)) {
  failures.push(`manifest scripts drifted from the reviewed candidate: ${Object.keys(manifest.scripts ?? {}).join(", ")}`);
}

if (failures.length > 0) {
  process.stderr.write(failures.map((failure) => `FAIL ${failure}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(`packed-file check ok (${packedFiles.length} files, version ${manifest.version})\n`);
