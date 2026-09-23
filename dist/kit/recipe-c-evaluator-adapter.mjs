/** Recipe C: a thin adapter around an existing evaluator.
 *
 * Replace `callExistingEvaluator` with your evaluator client. Provider
 * authentication and payload translation stay there. Your organization's thresholds
 * and hard rules stay below, outside the provider response.
 */

const MAX_RISK_SCORE = 0.2;

function callExistingEvaluator(candidate) {
  const text = typeof candidate?.text === "string" ? candidate.text.toLowerCase() : "";
  const blocked = ["guaranteed profit", "send your password"].some((phrase) => text.includes(phrase));
  return {
    decision: blocked ? "block" : "allow",
    risk_score: blocked ? 0.98 : 0.08,
    stable_rules: { evaluator_policy_passed: !blocked },
  };
}

/** The evaluator dependency is chosen by the application, never by a candidate. */
export function createEvaluatorCheck(evaluator = callExistingEvaluator) {
  if (typeof evaluator !== "function") throw new TypeError("evaluator must be a function");
  const evaluations = new WeakMap();

  async function translateOnce(candidate) {
    const result = await evaluator(candidate);
    if (!result || !["allow", "block"].includes(result.decision)
      || !Number.isFinite(result.risk_score) || result.risk_score < 0 || result.risk_score > 1
      || typeof result.stable_rules?.evaluator_policy_passed !== "boolean") {
      throw new Error("existing evaluator returned an unsupported response");
    }
    const anchor_results = {
      evaluator_allowed: result.decision === "allow",
      risk_within_organization_limit: result.risk_score <= MAX_RISK_SCORE,
      evaluator_policy_passed: result.stable_rules.evaluator_policy_passed,
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

  return {
    async runHardCheck(candidate) {
      const { anchor_results } = await translated(candidate);
      return { is_correct: Object.values(anchor_results).every(Boolean), anchor_results };
    },
    async scoreQuality(candidate) {
      return 1 - (await translated(candidate)).result.risk_score;
    },
  };
}

const defaultCheck = createEvaluatorCheck();
export const runHardCheck = defaultCheck.runHardCheck;
export const scoreQuality = defaultCheck.scoreQuality;

export const labelledCases = [
  {
    id: "c-pass-existing-evaluator",
    label: "the evaluator allows ordinary content within your risk limit",
    candidate: { text: "The item ships tomorrow and includes a tracking number." },
    expect: {
      is_correct: true,
      quality_score: { min: 0.9 },
      anchor_results: { evaluator_allowed: true, risk_within_organization_limit: true },
    },
  },
  {
    id: "c-reject-existing-evaluator",
    label: "your policy rejects evaluator-blocked content",
    candidate: { text: "Send your password to claim a guaranteed profit." },
    expect: {
      is_correct: false,
      quality_score: { max: 0.1 },
      anchor_results: { evaluator_allowed: false, risk_within_organization_limit: false },
    },
  },
  {
    id: "c-technical-invalid-check-result",
    label: "an invalid output-check result is a technical failure with no verdict",
    candidate: { text: "A safe local fault fixture." },
    fault: "invalid_result",
    expect: { technical_failure: { status: 500 } },
  },
  {
    id: "c-technical-evaluator",
    label: "an evaluator outage is a technical failure with no verdict",
    candidate: { text: "A safe local fault fixture." },
    fault: "check_throws",
    expect: { technical_failure: { status: 500 } },
  },
];
