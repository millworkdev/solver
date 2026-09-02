// Negative fixtures for the public-content check. Every deny class must fail
// for its intended reason (the class id appears in the failure), and the
// legal near-misses must stay legal. This file is excluded from the content
// scan because it deliberately contains the forbidden phrases it proves.

import assert from "node:assert/strict";
import { test } from "node:test";
import { scanSourceMap, scanTextContent } from "./check-public-content.mjs";

const existsNever = { fileExists: () => false };
const existsAlways = { fileExists: () => true };

function onlyFailure(failures, id) {
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.ok(failures[0].includes(`(${id})`), `expected class ${id}, got: ${failures[0]}`);
}

test("clean prose passes", () => {
  assert.deepEqual(scanTextContent("dist/example.js", "// a plain public comment\n", existsAlways), []);
});

for (const [name, sample] of [
  ["scope row identifier", "per scope row T3 of the plan"],
  ["bare row identifier", "added for row M0 parity"],
  ["reversed row identifier", "the S1 row requires this"],
  ["launch scope reference", "because the launch scope requires it"],
]) {
  test(`internal-row-identifier fails closed: ${name}`, () => {
    onlyFailure(scanTextContent("dist/example.js", sample, existsAlways), "internal-row-identifier");
  });
}

test("legacy BYOK wording fails closed", () => {
  onlyFailure(scanTextContent("dist/example.js", "the BYOK binding", existsAlways), "legacy-byok-wording");
});

test("the lowercase byok wire literal stays legal", () => {
  assert.deepEqual(scanTextContent("dist/types.d.ts", 'access_lane: "byok";', existsAlways), []);
});

test("data-model row prose stays legal", () => {
  assert.deepEqual(
    scanTextContent("dist/types.d.ts", "/** Present only when the ledger row recorded a receipt. */", existsAlways),
    [],
  );
});

test("internal planning terms fail closed", () => {
  onlyFailure(scanTextContent("dist/example.js", "see the punchlist entry", existsAlways), "internal-planning-term");
});

test("internal product name fails closed", () => {
  onlyFailure(scanTextContent("dist/example.js", "the SolverAPI backend", existsAlways), "internal-product-name");
});

test("the published SolverApiError class name stays legal", () => {
  assert.deepEqual(scanTextContent("dist/example.js", "throw new SolverApiError()", existsAlways), []);
});

test("agent instruction files fail closed", () => {
  onlyFailure(scanTextContent("README.md", "see AGENTS.md there", existsAlways), "agent-instruction-file");
});

test("references to files that are not public fail closed", () => {
  onlyFailure(scanTextContent("dist/example.js", "per docs/DESIGN.md rules", existsNever), "nonpublic-reference");
});

test("references to files that exist here stay legal", () => {
  assert.deepEqual(scanTextContent("dist/example.js", 'import "../httpClient.js";', existsAlways), []);
});

test("bare 40-hex commit identifiers fail closed outside workflows", () => {
  onlyFailure(scanTextContent("PUBLISHING.md", `built at ${"ab".repeat(20)}`, existsAlways), "commit-identifier");
});

test("workflow action pins stay legal", () => {
  assert.deepEqual(
    scanTextContent(".github/workflows/example.yml", `uses: actions/checkout@${"ab".repeat(20)}`, existsAlways),
    [],
  );
});

test("a non-action-pin 40-hex value in a workflow fails closed", () => {
  onlyFailure(
    scanTextContent(".github/workflows/example.yml", `# built from ${"ab".repeat(20)}`, existsAlways),
    "commit-identifier",
  );
});

test("prefix-lookalike repository URLs fail closed", () => {
  onlyFailure(
    scanTextContent("README.md", "see https://github.com/millworkdev/solver-private", existsAlways),
    "disallowed-url",
  );
  onlyFailure(
    scanTextContent("README.md", "see https://github.com/millworkdev/solver.evil", existsAlways),
    "disallowed-url",
  );
});

test("real subpaths of the exact repository stay legal", () => {
  assert.deepEqual(
    scanTextContent("README.md", "see https://github.com/millworkdev/solver/pull/1", existsAlways),
    [],
  );
});

test("absolute filesystem paths fail closed", () => {
  onlyFailure(scanTextContent("dist/example.js", 'read "/Users/someone/thing"', existsAlways), "absolute-path");
});

test("secret-shaped material fails closed", () => {
  onlyFailure(scanTextContent("dist/example.js", `token npm_${"a1".repeat(12)} here`, existsAlways), "secret-material");
});

test("URLs outside the allowed public set fail closed", () => {
  onlyFailure(scanTextContent("README.md", "see https://example.com/private", existsAlways), "disallowed-url");
});

test("allowed public URLs stay legal", () => {
  const sample = [
    "https://github.com/millworkdev/solver.git",
    "https://www.npmjs.com/package/@millwork/solver",
    "https://registry.npmjs.org",
    "https://api.getmillwork.dev/v1",
  ].join(" ");
  assert.deepEqual(scanTextContent("README.md", sample, existsAlways), []);
});

test("source maps embedding source text fail closed", () => {
  onlyFailure(
    scanSourceMap("dist/example.js.map", JSON.stringify({ sources: ["../a.ts"], sourcesContent: ["code"] })),
    "sources-content",
  );
});

test("absolute source map sources fail closed", () => {
  onlyFailure(scanSourceMap("dist/example.js.map", JSON.stringify({ sources: ["/private/a.ts"] })), "absolute-map-source");
});

test("relative source maps without embedded text stay legal", () => {
  assert.deepEqual(scanSourceMap("dist/example.js.map", JSON.stringify({ sources: ["../a.ts"] })), []);
});
