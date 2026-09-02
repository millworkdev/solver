// Deterministic public-content check for this publishing repository.
//
// Everything in this repository is permanent public history, and the packed
// file set becomes an immutable registry artifact. This scan fails closed on
// content that must never appear here: references to files that do not exist
// in this repository or in the packed artifact, internal planning or product
// identifiers (including row/scope identifiers and legacy BYOK wording),
// bare 40-hex commit identifiers outside workflow action pins, absolute
// filesystem paths, secret-shaped material, source maps that embed source
// text, and links to repositories other than this one.
//
// Run: node scripts/check-public-content.mjs   (exits nonzero on violation)
// Tested by: node --test scripts/test-check-public-content.mjs

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// These two files hold the deny patterns and their negative fixtures, so
// scanning them would always self-flag; they are reviewed by eye instead.
const excludedFromTextScan = new Set([
  "scripts/check-public-content.mjs",
  "scripts/test-check-public-content.mjs",
]);

export const allowedUrlPatterns = [
  // Exact public repository coordinate only: optional .git, optional real
  // subpath. Prefix lookalikes (solver-private, solver.evil) must not pass.
  /^https:\/\/github\.com\/millworkdev\/solver(?:\.git)?(?:\/[^\s]*)?$/,
  /^https?:\/\/(?:www\.)?npmjs\.com\//,
  /^https:\/\/registry\.npmjs\.org(?:\/|$)/,
  /^https?:\/\/(?:www\.)?apache\.org\//,
  /^https:\/\/api\.getmillwork\.dev\//,
  /^https:\/\/docs\.getmillwork\.dev(?:\/|$)/,
  /^https?:\/\/docs\.npmjs\.com\//,
  // Pinned, checksum-verified CI tooling download only.
  /^https:\/\/github\.com\/rhysd\/actionlint\//,
];

export const forbiddenPatterns = [
  { id: "internal-planning-term", pattern: /\bpunch-?list\b/i },
  // Internal delivery-row identifiers: "row T3", "M0 row", "scope row",
  // "launch scope". Data-model prose like "the ledger row recorded" stays
  // legal because these require a letter+digit identifier or the scope noun.
  { id: "internal-row-identifier", pattern: /\brow\s+[A-Z]{1,2}\d+\b|\b[A-Z]{1,2}\d+\s+row\b|\bscope\s+row\b|\blaunch\s+scope\b/ },
  // Uppercase BYOK is legacy internal wording; the lowercase "byok" wire
  // literal is part of the published API contract and must not be flagged.
  { id: "legacy-byok-wording", pattern: /\bBYOK\b/ },
  { id: "agent-instruction-file", pattern: /\b(?:AGENTS|CLAUDE)\.md\b/ },
  { id: "internal-product-name", pattern: /\bSolverAPI\b/ },
  { id: "absolute-path", pattern: /(?:^|["'\s(=])\/(?:Users|home|private\/tmp|var\/folders)\// },
  { id: "secret-material", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bnpm_[A-Za-z0-9]{20,}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b/ },
];

// A repository-layout path reference (something/like/this.ext) is allowed
// only when the referenced file actually exists here, resolved against the
// repository root or against the referencing file's own directory. Anything
// else points a permanent public reader at material that is not public.
const pathReferencePattern = /(?:\.\.?\/)*[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z]{1,5}\b/g;

export function scanTextContent(path, raw, { fileExists = defaultFileExists } = {}) {
  const failures = [];
  const urls = raw.match(/https?:\/\/[^\s"'`)\]>]+/g) ?? [];
  for (const url of urls) {
    if (!allowedUrlPatterns.some((pattern) => pattern.test(url))) {
      failures.push(`${path}: URL outside the allowed public set (disallowed-url): ${url}`);
    }
  }
  // Scan with URLs removed so hostname/path segments are not double-counted.
  const text = raw.replace(/https?:\/\/[^\s"'`)\]>]+/g, " ");
  for (const { id, pattern } of forbiddenPatterns) {
    const match = text.match(pattern);
    if (match) failures.push(`${path}: forbidden content (${id}): ${match[0]}`);
  }
  // The only legal 40-hex values are action pins in workflow files
  // (uses: owner/action@<full-sha>); strip exactly those, then any
  // remaining 40-hex value in any file is a commit identifier leak.
  const textWithoutActionPins = path.startsWith(".github/workflows/")
    ? text.replace(/\buses:\s*[A-Za-z0-9_./-]+@[0-9a-f]{40}\b/g, " ")
    : text;
  const shaMatch = textWithoutActionPins.match(/\b[0-9a-f]{40}\b/);
  if (shaMatch) failures.push(`${path}: bare 40-hex commit identifier outside a workflow action pin (commit-identifier)`);
  for (const reference of text.match(pathReferencePattern) ?? []) {
    if (!fileExists(path, reference)) {
      failures.push(`${path}: reference to a file that is not public here (nonpublic-reference): ${reference}`);
    }
  }
  return failures;
}

export function scanSourceMap(path, raw) {
  const failures = [];
  const map = JSON.parse(raw);
  if ("sourcesContent" in map) {
    failures.push(`${path}: source map embeds source text (sources-content)`);
  }
  for (const source of map.sources ?? []) {
    if (source.startsWith("/") || /^[A-Za-z]+:/.test(source)) {
      failures.push(`${path}: non-relative source map source (absolute-map-source): ${source}`);
    }
  }
  return failures;
}

function defaultFileExists(fromPath, reference) {
  return (
    existsSync(resolve(repositoryRoot, reference)) ||
    existsSync(resolve(repositoryRoot, dirname(fromPath), reference))
  );
}

function listFiles(directory) {
  const entries = [];
  for (const name of readdirSync(directory)) {
    if (name === ".git" || name === "node_modules") continue;
    const fullPath = join(directory, name);
    if (statSync(fullPath).isDirectory()) entries.push(...listFiles(fullPath));
    else entries.push(relative(repositoryRoot, fullPath).split("\\").join("/"));
  }
  return entries;
}

function main() {
  const allFiles = listFiles(repositoryRoot).sort();
  const mapFiles = allFiles.filter((path) => path.endsWith(".map"));
  const textFiles = allFiles.filter((path) => !excludedFromTextScan.has(path) && !path.endsWith(".map"));
  const failures = [];
  for (const path of textFiles) {
    failures.push(...scanTextContent(path, readFileSync(resolve(repositoryRoot, path), "utf8")));
  }
  for (const path of mapFiles) {
    failures.push(...scanSourceMap(path, readFileSync(resolve(repositoryRoot, path), "utf8")));
  }
  if (failures.length > 0) {
    process.stderr.write(failures.map((failure) => `FAIL ${failure}`).join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write(`public-content check ok (${textFiles.length} text files, ${mapFiles.length} source maps)\n`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
