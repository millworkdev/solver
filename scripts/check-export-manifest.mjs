// Verify every committed public dist byte against the generated closed-world
// export manifest, including its aggregate digest.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(repositoryRoot, "export-manifest.json"), "utf8"));
const failures = [];

function listFiles(directory) {
  const entries = [];
  for (const name of readdirSync(directory)) {
    const fullPath = join(directory, name);
    if (statSync(fullPath).isDirectory()) entries.push(...listFiles(fullPath));
    else entries.push(fullPath);
  }
  return entries;
}

if (manifest.manifest_id !== "millwork.solver.public-export-manifest.v1") {
  failures.push(`unexpected manifest id: ${manifest.manifest_id}`);
}

const actualFiles = listFiles(join(repositoryRoot, "dist"))
  .map((path) => ({
    path: `dist/${relative(join(repositoryRoot, "dist"), path).split("\\").join("/")}`,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }))
  .sort((left, right) => left.path.localeCompare(right.path));
const manifestFiles = [...manifest.files].sort((left, right) => left.path.localeCompare(right.path));

if (JSON.stringify(actualFiles) !== JSON.stringify(manifestFiles)) {
  const actualByPath = new Map(actualFiles.map((file) => [file.path, file.sha256]));
  const manifestByPath = new Map(manifestFiles.map((file) => [file.path, file.sha256]));
  for (const [path, sha256] of manifestByPath) {
    if (!actualByPath.has(path)) failures.push(`manifest names a missing file: ${path}`);
    else if (actualByPath.get(path) !== sha256) failures.push(`hash mismatch for ${path}`);
  }
  for (const path of actualByPath.keys()) {
    if (!manifestByPath.has(path)) failures.push(`file not in the manifest: ${path}`);
  }
}
if (manifest.file_count !== actualFiles.length) {
  failures.push(`manifest file_count ${manifest.file_count} does not match ${actualFiles.length} actual files`);
}

const digestText = actualFiles
  .map((file) => `${file.sha256}  ./${file.path.replace(/^dist\//, "")}\n`)
  .join("");
const aggregate = createHash("sha256").update(digestText).digest("hex");
if (aggregate !== manifest.aggregate_sha256) {
  failures.push(`aggregate digest mismatch: recomputed ${aggregate}, manifest ${manifest.aggregate_sha256}`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `FAIL ${failure}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`export manifest ok (${actualFiles.length} files, aggregate ${aggregate})\n`);
