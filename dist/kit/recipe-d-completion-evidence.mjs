/** Recipe D: agent or pipeline completion from trusted evidence.
 *
 * The candidate supplies a safe evidence id, never its own prose assertion of
 * success. Replace this fixture map with reads from your CI or artifact store.
 */

const TRUSTED_EVIDENCE = new Map([
  ["ci-pass-100", {
    patch_present: true,
    required_tests_passed: true,
    migration_invariant_preserved: true,
    tools_allowed: true,
    artifact_hash_recorded: true,
    explanation_quality: 0.9,
  }],
  ["ci-fail-101", {
    patch_present: true,
    required_tests_passed: false,
    migration_invariant_preserved: true,
    tools_allowed: true,
    artifact_hash_recorded: true,
    explanation_quality: 0.8,
  }],
]);
const evaluations = new WeakMap();

async function readTrustedEvidenceOnce(candidate) {
  if (candidate?.simulate === "technical_failure") {
    throw new Error("labelled recipe D fixture: CI evidence store unavailable");
  }
  const evidence = TRUSTED_EVIDENCE.get(candidate?.evidence_id);
  return evidence ?? {
    patch_present: false,
    required_tests_passed: false,
    migration_invariant_preserved: false,
    tools_allowed: false,
    artifact_hash_recorded: false,
    explanation_quality: 0,
  };
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
  const anchor_results = {
    evidence_found: TRUSTED_EVIDENCE.has(candidate?.evidence_id),
    patch_present: evidence.patch_present,
    required_tests_passed: evidence.required_tests_passed,
    migration_invariant_preserved: evidence.migration_invariant_preserved,
    tools_allowed: evidence.tools_allowed,
    artifact_hash_recorded: evidence.artifact_hash_recorded,
  };
  return { is_correct: Object.values(anchor_results).every(Boolean), anchor_results };
}

export async function scoreQuality(candidate) {
  if (candidate?.simulate === "technical_failure") return 0;
  return (await readTrustedEvidence(candidate)).explanation_quality;
}

export const labelledCases = [
  {
    id: "d-pass-trusted-evidence",
    label: "trusted CI evidence proves every required completion anchor",
    candidate: { evidence_id: "ci-pass-100", summary: "The candidate's prose is not used as proof." },
    expect: {
      is_correct: true,
      quality_score: { min: 0.9 },
      anchor_results: { required_tests_passed: true, artifact_hash_recorded: true },
    },
  },
  {
    id: "d-reject-failed-tests",
    label: "trusted CI evidence rejects completion when required tests failed",
    candidate: { evidence_id: "ci-fail-101", summary: "I claim all tests passed, but the store disagrees." },
    expect: { is_correct: false, anchor_results: { required_tests_passed: false } },
  },
  {
    id: "d-technical-evidence-store",
    label: "an unavailable evidence store is a technical failure with no verdict",
    candidate: { simulate: "technical_failure" },
    expect: { technical_failure: { status: 500 } },
  },
];
