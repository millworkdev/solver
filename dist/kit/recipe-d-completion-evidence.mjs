/** Recipe D: agent or pipeline completion from trusted evidence.
 *
 * The candidate supplies a safe evidence id, never its own prose assertion of
 * success. Replace `readTrustedEvidenceById` with a read from your CI or
 * artifact store; do not accept evidence fields from the candidate.
 */

import { createHash } from "node:crypto";

const REQUIRED_TEST_IDS = ["unit", "integration"];
const SAFE_EVIDENCE_ID = /^ci-[a-z0-9-]{1,64}$/;
const ARTIFACT_BODY = "approved patch artifact\n";
const REQUIRED_ARTIFACT_SHA256 = "15369fff8735b3b98553a91e73a72f809e32a67b0efe406264e22a2b4629145e";

const TRUSTED_EVIDENCE = new Map([
  ["ci-pass-100", {
    artifact: { body: ARTIFACT_BODY, sha256: REQUIRED_ARTIFACT_SHA256 },
    test_results: [{ id: "unit", passed: true }, { id: "integration", passed: true }],
    migration_invariant_preserved: true,
    tools_allowed: true,
    explanation_quality: 0.9,
  }],
  ["ci-fail-101", {
    artifact: { body: ARTIFACT_BODY, sha256: REQUIRED_ARTIFACT_SHA256 },
    test_results: [{ id: "unit", passed: true }, { id: "integration", passed: false }],
    migration_invariant_preserved: true,
    tools_allowed: true,
    explanation_quality: 0.8,
  }],
  ["ci-hash-102", {
    artifact: { body: ARTIFACT_BODY, sha256: "0".repeat(64) },
    test_results: [{ id: "unit", passed: true }, { id: "integration", passed: true }],
    migration_invariant_preserved: true,
    tools_allowed: true,
    explanation_quality: 0.8,
  }],
]);
const evaluations = new WeakMap();

async function readTrustedEvidenceById(evidenceId) {
  if (typeof evidenceId !== "string" || !SAFE_EVIDENCE_ID.test(evidenceId)) return null;
  return TRUSTED_EVIDENCE.get(evidenceId) ?? null;
}

async function readTrustedEvidenceOnce(candidate) {
  return readTrustedEvidenceById(candidate?.evidence_id);
}

function readTrustedEvidence(candidate) {
  if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return readTrustedEvidenceOnce(candidate);
  }
  const existing = evaluations.get(candidate);
  if (existing) return existing;
  const pending = readTrustedEvidenceOnce(candidate);
  evaluations.set(candidate, pending);
  return pending;
}

export async function runHardCheck(candidate) {
  const evidence = await readTrustedEvidence(candidate);
  const artifact = evidence?.artifact;
  const testResults = evidence?.test_results;
  if (evidence && (typeof artifact?.body !== "string" || typeof artifact?.sha256 !== "string"
    || !Array.isArray(testResults) || typeof evidence.migration_invariant_preserved !== "boolean"
    || typeof evidence.tools_allowed !== "boolean")) {
    throw new Error("trusted evidence has an unsupported shape");
  }
  const required_test_ids_present = REQUIRED_TEST_IDS.every((id) =>
    testResults?.filter((result) => result.id === id).length === 1);
  const anchor_results = {
    evidence_found: evidence !== null,
    patch_present: Boolean(artifact),
    required_test_ids_present,
    required_tests_passed: required_test_ids_present && REQUIRED_TEST_IDS.every((id) =>
      testResults.find((result) => result.id === id).passed === true),
    migration_invariant_preserved: evidence?.migration_invariant_preserved === true,
    tools_allowed: evidence?.tools_allowed === true,
    artifact_hash_matches: Boolean(artifact)
      && createHash("sha256").update(artifact.body).digest("hex") === artifact.sha256
      && artifact.sha256 === REQUIRED_ARTIFACT_SHA256,
  };
  return { is_correct: Object.values(anchor_results).every(Boolean), anchor_results };
}

export async function scoreQuality(candidate) {
  return (await readTrustedEvidence(candidate))?.explanation_quality ?? 0;
}

export const labelledCases = [
  {
    id: "d-pass-trusted-evidence",
    label: "trusted CI evidence proves every required completion anchor",
    candidate: { evidence_id: "ci-pass-100", summary: "The candidate's prose is not used as proof." },
    expect: {
      is_correct: true,
      quality_score: { min: 0.9 },
      anchor_results: { required_test_ids_present: true, required_tests_passed: true, artifact_hash_matches: true },
    },
  },
  {
    id: "d-reject-failed-tests",
    label: "trusted CI evidence rejects completion when required tests failed",
    candidate: { evidence_id: "ci-fail-101", summary: "I claim all tests passed, but the store disagrees." },
    expect: { is_correct: false, anchor_results: { required_tests_passed: false } },
  },
  {
    id: "d-reject-hash-mismatch",
    label: "a trusted artifact whose recorded hash does not match is rejected",
    candidate: { evidence_id: "ci-hash-102" },
    expect: { is_correct: false, anchor_results: { artifact_hash_matches: false } },
  },
  {
    id: "d-technical-evidence-store",
    label: "an unavailable evidence store is a technical failure with no verdict",
    candidate: { evidence_id: "ci-fault-test" },
    fault: "check_throws",
    expect: { technical_failure: { status: 500 } },
  },
];
