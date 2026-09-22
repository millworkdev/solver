/** Recipe C: a thin adapter around an existing evaluator.
 *
 * Replace `callExistingEvaluator` with your evaluator client. Provider
 * authentication and payload translation stay there. Tenant-owned thresholds
 * and hard rules stay below, outside the provider response.
 */

const MAX_RISK_SCORE = 0.2;
const evaluations = new WeakMap();

function callExistingEvaluator(candidate) {
  if (candidate?.simulate === "technical_failure") {
    throw new Error("labelled recipe C fixture: evaluator unavailable");
  }
  const text = String(candidate?.text ?? "").toLowerCase();
  const blocked = ["guaranteed profit", "send your password"].some((phrase) => text.includes(phrase));
  return {
    decision: blocked ? "block" : "allow",
    risk_score: blocked ? 0.98 : 0.08,
    stable_rules: { evaluator_policy_passed: !blocked },
  };
}

async function translateOnce(candidate) {
  const result = await callExistingEvaluator(candidate);
  if (!result || !["allow", "block"].includes(result.decision)
    || typeof result.risk_score !== "number" || result.risk_score < 0 || result.risk_score > 1) {
    throw new Error("existing evaluator returned an unsupported response");
  }
  const anchor_results = {
    evaluator_allowed: result.decision === "allow",
    risk_within_tenant_limit: result.risk_score <= MAX_RISK_SCORE,
    evaluator_policy_passed: result.stable_rules?.evaluator_policy_passed === true,
  };
  return { result, anchor_results };
}

function translated(candidate) {
  if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return translateOnce(candidate);
  }
  const existing = evaluations.get(candidate);
  if (existing) return existing;
  const pending = translateOnce(candidate);
  evaluations.set(candidate, pending);
  return pending;
}

export async function runHardCheck(candidate) {
  const { anchor_results } = await translated(candidate);
  return { is_correct: Object.values(anchor_results).every(Boolean), anchor_results };
}

export async function scoreQuality(candidate) {
  if (candidate?.simulate === "technical_failure") return 0;
  return 1 - (await translated(candidate)).result.risk_score;
}

export const labelledCases = [
  {
    id: "c-pass-existing-evaluator",
    label: "the evaluator allows ordinary content within the tenant risk limit",
    candidate: { text: "The item ships tomorrow and includes a tracking number." },
    expect: {
      is_correct: true,
      quality_score: { min: 0.9 },
      anchor_results: { evaluator_allowed: true, risk_within_tenant_limit: true },
    },
  },
  {
    id: "c-reject-existing-evaluator",
    label: "the tenant policy rejects evaluator-blocked content",
    candidate: { text: "Send your password to claim a guaranteed profit." },
    expect: {
      is_correct: false,
      quality_score: { max: 0.1 },
      anchor_results: { evaluator_allowed: false, risk_within_tenant_limit: false },
    },
  },
  {
    id: "c-technical-evaluator",
    label: "an evaluator outage is a technical failure with no verdict",
    candidate: { simulate: "technical_failure" },
    expect: { technical_failure: { status: 500 } },
  },
];
