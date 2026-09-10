// Negative fixtures for the public-content check. Every deny class must fail
// for its intended reason (the class id appears in the failure), and the
// legal near-misses must stay legal. This file is excluded from the content
// scan because it deliberately contains the forbidden phrases it proves.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultFileExists, resolvesInsideRepository, scanSourceMap, scanTextContent } from "./check-public-content.mjs";

const scannerPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-public-content.mjs");

const existsNever = { fileExists: () => false };
const existsAlways = { fileExists: () => true };

function onlyFailure(failures, id) {
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.ok(failures[0].includes(`(${id})`), `expected class ${id}, got: ${failures[0]}`);
}

test("clean prose passes", () => {
  assert.deepEqual(scanTextContent("dist/example.js", "// a plain public comment\n", existsAlways), []);
});

test("provider recovery permits only exact public help and key destinations", () => {
  for (const url of [
    "https://openrouter.ai/keys",
    "https://help.openai.com/en/articles/9186755-managing-your-work-in-platform-with-projects",
    "https://platform.claude.com/docs/en/api/overview#prerequisites",
    "https://ai.google.dev/gemini-api/docs/api-key",
    "https://docs.x.ai/console/faq/security",
    "https://platform.kimi.ai/docs/overview",
    "https://api-docs.deepseek.com/",
    "https://app.fireworks.ai/settings/users/api-keys",
    "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_use-resources.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html#api-keys-gen-short",
  ]) {
    assert.deepEqual(scanTextContent("dist/cliProviderLifecycle.js", url, existsNever), []);
    for (const unsafe of [url + "?token=private", url + "/unapproved", url.replace(/(https:\/\/[^/]+)/, "$1.evil.invalid")]) {
      onlyFailure(scanTextContent("dist/cliProviderLifecycle.js", unsafe, existsNever), "disallowed-url");
    }
  }
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

test("a candidate resolving outside the repository is never satisfied", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(resolvesInsideRepository(resolve(root, "dist/cli.js")), true);
  assert.equal(resolvesInsideRepository(resolve(root, "../private/secret.md")), false);
  assert.equal(resolvesInsideRepository(resolve(root, "dist/../../private/secret.md")), false);
  // The root itself is a directory, not a file a reference may name.
  assert.equal(resolvesInsideRepository(root), false);
  assert.equal(defaultFileExists("README.md", "../private/secret.md"), false);
});

test("an EXISTING sibling outside the repository still fails closed", () => {
  // The dangerous case is not a missing file, it is a real one next door: a
  // sync workspace has private checkouts as siblings, so a guard that only
  // tests existence accepts the pointer precisely when the material is there.
  const workspace = mkdtempSync(join(tmpdir(), "public-content-escape-"));
  try {
    mkdirSync(join(workspace, "public/scripts"), { recursive: true });
    mkdirSync(join(workspace, "private"), { recursive: true });
    writeFileSync(join(workspace, "private/secret.md"), "internal notes\n");
    writeFileSync(join(workspace, "public/guide.md"), "See ../private/secret.md for details.\n");
    copyFileSync(scannerPath, join(workspace, "public/scripts/check-public-content.mjs"));

    let output = "";
    let rejected = false;
    try {
      output = execFileSync("node", ["scripts/check-public-content.mjs"], {
        cwd: join(workspace, "public"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      rejected = true;
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
    assert.ok(rejected, `expected rejection, scanner passed: ${output.trim()}`);
    assert.match(output, /nonpublic-reference/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an inline regex literal with a method call is rejected, and naming it is the fix", () => {
  // The scanner does not parse JavaScript, and a suffix cannot establish that it
  // is looking at one: i.test, g.exec, gui.test and g.flags are all valid file
  // names. So nothing is exempted. An inline literal emits bytes shaped exactly
  // like a path, and the repair is to name the pattern where it is written.
  onlyFailure(
    scanTextContent("dist/a.js", '/plan digest has expired/i.test(detail)', existsNever),
    "nonpublic-reference",
  );
  assert.deepEqual(
    scanTextContent("dist/a.js", "EXPIRED_PLAN_DIGEST_DETAIL.test(detail)", existsNever),
    [],
  );
  // A literal that is not followed by a member access never had the shape.
  assert.deepEqual(scanTextContent("dist/a.js", "const re = /[a-z]+x/g;", existsNever), []);
});

test("a reference whose name merely resembles regex flags is still checked", () => {
  for (const line of [
    "// See fixtures/i.test for details.",
    'const fixture = "fixtures/g.exec";',
    "// See tests/gui.test for details.",
    'const fixture = "fixtures/g.flags";',
  ]) {
    onlyFailure(scanTextContent("dist/sample.js", line, existsNever), "nonpublic-reference");
  }
});

test("relative references in code survive to be scanned", () => {
  for (const line of [
    "// See ./missing/note.md for details.",
    'const note = "./missing/note.md";',
    "// See ../outside/secret.md for details.",
    'const note = "../outside/secret.md";',
    "// See ../outside/i.test for details.",
  ]) {
    onlyFailure(scanTextContent("dist/sample.js", line, existsNever), "nonpublic-reference");
  }
});

test("a genuine nonpublic reference beside a named pattern is still caught", () => {
  onlyFailure(
    scanTextContent("dist/example.js", 'EXPIRED.test(x); // per docs/DESIGN.md', existsNever),
    "nonpublic-reference",
  );
});

test("prose is scanned by the same rule, with nothing exempted", () => {
  onlyFailure(
    scanTextContent("README.md", "matched by phrase/i.test", existsNever),
    "nonpublic-reference",
  );
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

test("documentation URL lookalikes fail closed", () => {
  onlyFailure(
    scanTextContent("SUPPORT.md", "see https://docs.getmillwork.dev.evil/help", existsAlways),
    "disallowed-url",
  );
});

test("allowed public URLs stay legal", () => {
  const sample = [
    "https://github.com/millworkdev/solver.git",
    "https://www.npmjs.com/package/@millwork/solver",
    "https://registry.npmjs.org",
    "https://api.getmillwork.dev/v1",
    "https://docs.getmillwork.dev",
  ].join(" ");
  assert.deepEqual(scanTextContent("README.md", sample, existsAlways), []);
});

test("the two customer destinations the CLI prints stay legal", () => {
  const sample = "https://app.getmillwork.dev/keys https://app.getmillwork.dev/billing";
  assert.deepEqual(scanTextContent("dist/cliGuidance.js", sample, existsAlways), []);
});

test("any other app subpath fails closed", () => {
  onlyFailure(scanTextContent("README.md", "see https://app.getmillwork.dev/admin", existsAlways), "disallowed-url");
  onlyFailure(scanTextContent("README.md", "see https://app.getmillwork.dev/keys/export", existsAlways), "disallowed-url");
});

test("app host lookalikes fail closed", () => {
  onlyFailure(scanTextContent("README.md", "see https://app.getmillwork.dev.evil/keys", existsAlways), "disallowed-url");
  onlyFailure(scanTextContent("README.md", "see https://notapp.getmillwork.dev/keys", existsAlways), "disallowed-url");
});

test("prose ending on a customer destination stays legal", () => {
  assert.deepEqual(
    scanTextContent("README.md", "Create a key at https://app.getmillwork.dev/keys.", existsAlways),
    [],
  );
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
