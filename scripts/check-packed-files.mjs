// The packed artifact must contain exactly the generated export inventory plus
// npm's three package files, and its manifest must expose the reviewed CLI.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const exportManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "export-manifest.json"), "utf8"));
if (exportManifest.manifest_id !== "millwork.solver.public-export-manifest.v1") {
  failures.push(`unexpected export manifest id: ${exportManifest.manifest_id}`);
}
const distFiles = exportManifest.files.map((file) => file.path);
const allowedPackedFiles = ["LICENSE", "README.md", "package.json", ...distFiles].sort();

const packOutput = JSON.parse(execFileSync(
  "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
));
const packedFiles = packOutput[0].files.map((file) => file.path).sort();
if (JSON.stringify(packedFiles) !== JSON.stringify(allowedPackedFiles)) {
  const extra = packedFiles.filter((file) => !allowedPackedFiles.includes(file));
  const missing = allowedPackedFiles.filter((file) => !packedFiles.includes(file));
  if (extra.length > 0) failures.push(`packed files outside the export: ${extra.join(", ")}`);
  if (missing.length > 0) failures.push(`exported files missing from the pack: ${missing.join(", ")}`);
}

// The manifest version is the version of the artifact assembled here -- the
// publication candidate. Whether that version exists on the registry, and
// which tag points at it, is a separate fact established by a registry
// observation, not by this check.
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
if (manifest.name !== "@millwork/solver") failures.push(`manifest name is ${manifest.name}`);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || packOutput[0].version !== manifest.version) {
  failures.push(`packed candidate version disagrees with package.json: ${packOutput[0].version}`);
}
if (JSON.stringify(manifest.exports?.["./provider"]) !== JSON.stringify({ types: "./dist/provider/index.d.ts", import: "./dist/provider/index.js" })
  || manifest.imports?.["#provider-feed-validator"] !== "./dist/provider-validator/providerValidator.js"
  || manifest.imports?.["#provider-validation-context"] !== "./dist/provider-validator/providerValidationContext.js"
  || JSON.stringify(manifest.dependencies) !== JSON.stringify({ ajv: "^8.20.0" })) {
  failures.push("provider export, validator imports or reviewed runtime dependency drifted");
}
if (manifest.repository?.url !== "git+https://github.com/millworkdev/solver.git") {
  failures.push(`manifest repository does not name this exact public repository: ${manifest.repository?.url}`);
}
if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) {
  failures.push(`manifest files must be exactly [\"dist\"], got ${JSON.stringify(manifest.files)}`);
}
if (JSON.stringify(manifest.bin) !== JSON.stringify({ millwork: "./dist/cli.js" })) {
  failures.push(`manifest bin drifted: ${JSON.stringify(manifest.bin)}`);
}
if (manifest.publishConfig?.access !== "public") failures.push("manifest publishConfig.access must be public");
if (manifest.publishConfig?.provenance !== undefined) {
  failures.push("manifest must not force provenance; trusted publishing supplies it");
}

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `FAIL ${failure}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `packed-file check ok (${packedFiles.length} files, candidate version ${manifest.version}, CLI present); `
  + "this says nothing about what is published on the registry\n",
);
