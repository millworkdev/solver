/** Recipe B: typed semantic judgment composed by tenant code.
 *
 * `askSemanticEngine` is an offline fixture so the shipped overlay runs without
 * a vendor account. Replace that one function with a focused Choice question
 * over the same state. Keep quote lookup, thresholds, abstention and the hard
 * verdict in code. Do not send Millwork's reserved probe to a paid service;
 * handler.mjs short-circuits it before this module runs.
 */

const AUTO_ACCEPT_CONFIDENCE = 0.8;
const evaluations = new WeakMap();

function normalized(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function askSemanticEngine(candidate) {
  if (candidate?.simulate === "technical_failure") {
    throw new Error("labelled recipe B fixture: semantic service unavailable");
  }
  const claim = normalized(candidate?.claim).toLowerCase();
  const source = normalized(candidate?.source).toLowerCase();
  if (claim.includes("returns within 30 days") && source.includes("returns are accepted within 30 days")) {
    return { relation: "supports", confidence: 0.96 };
  }
  if (claim.includes("returns within 90 days") && source.includes("returns are accepted within 30 days")) {
    return { relation: "contradicts", confidence: 0.95 };
  }
  return { relation: "says_nothing", confidence: 0.45 };
}

async function evaluateOnce(candidate) {
  const quote = normalized(candidate?.quote);
  const source = normalized(candidate?.source);
  const quote_present = quote !== "" && source.includes(quote);
  const judgment = await askSemanticEngine(candidate);
  const confident = judgment.confidence >= AUTO_ACCEPT_CONFIDENCE;
  const anchor_results = {
    source_present: source !== "",
    claim_present: normalized(candidate?.claim) !== "",
    quote_present,
    relation_supports: judgment.relation === "supports",
    confidence_meets_tenant_threshold: confident,
  };
  return { judgment, anchor_results };
}

function evaluate(candidate) {
  if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return evaluateOnce(candidate);
  }
  const existing = evaluations.get(candidate);
  if (existing) return existing;
  const pending = evaluateOnce(candidate);
  evaluations.set(candidate, pending);
  return pending;
}

export async function runHardCheck(candidate) {
  const { anchor_results } = await evaluate(candidate);
  return { is_correct: Object.values(anchor_results).every(Boolean), anchor_results };
}

export async function scoreQuality(candidate) {
  if (candidate?.simulate === "technical_failure") return 0;
  return (await evaluate(candidate)).judgment.confidence;
}

export const labelledCases = [
  {
    id: "b-pass-supported-citation",
    label: "an exact quote with a confident supporting relation passes",
    candidate: {
      claim: "The policy permits returns within 30 days.",
      quote: "Returns are accepted within 30 days",
      source: "Returns are accepted within 30 days when the item is unused.",
    },
    expect: {
      is_correct: true,
      quality_score: { min: 0.9 },
      anchor_results: { quote_present: true, relation_supports: true, confidence_meets_tenant_threshold: true },
    },
  },
  {
    id: "b-reject-contradicted-citation",
    label: "a quote present in the source still rejects a contradicted claim",
    candidate: {
      claim: "The policy permits returns within 90 days.",
      quote: "Returns are accepted within 30 days",
      source: "Returns are accepted within 30 days when the item is unused.",
    },
    expect: { is_correct: false, anchor_results: { quote_present: true, relation_supports: false } },
  },
  {
    id: "b-technical-semantic-service",
    label: "a semantic-service outage is a technical failure with no verdict",
    candidate: { simulate: "technical_failure" },
    expect: { technical_failure: { status: 500 } },
  },
];
