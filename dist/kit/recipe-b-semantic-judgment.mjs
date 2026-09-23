/** Recipe B: typed semantic judgment composed by your code.
 *
 * `askSemanticEngine` is an offline fixture so the shipped overlay runs without
 * a vendor account. Replace that one function with a focused Choice question
 * over the same state. Keep quote lookup, thresholds, abstention and the hard
 * verdict in code. Do not send Millwork's reserved probe to a paid service;
 * handler.mjs short-circuits it before this module runs.
 */

const AUTO_ACCEPT_CONFIDENCE = 0.8;

function normalized(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function askSemanticEngine(candidate) {
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

async function evaluateOnce(candidate, semanticEngine) {
  const claim = normalized(candidate?.claim);
  const quote = normalized(candidate?.quote);
  const source = normalized(candidate?.source);
  const source_present = source !== "";
  const claim_present = claim !== "";
  const quote_present = quote !== "" && source.includes(quote);
  // Exact failures already decide the hard verdict. Do not call an external
  // evaluator for them: an outage must not hide a deterministic rejection.
  if (!source_present || !claim_present || !quote_present) {
    return {
      anchor_results: {
        source_present,
        claim_present,
        quote_present,
        relation_supports: false,
        confidence_meets_threshold: false,
      },
      evidence_quality: 0,
    };
  }
  const judgment = await semanticEngine(candidate);
  if (!judgment || !["supports", "contradicts", "says_nothing"].includes(judgment.relation)
    || !Number.isFinite(judgment.confidence) || judgment.confidence < 0 || judgment.confidence > 1) {
    throw new Error("semantic service returned an unsupported response");
  }
  const confident = judgment.confidence >= AUTO_ACCEPT_CONFIDENCE;
  const anchor_results = {
    source_present,
    claim_present,
    quote_present,
    relation_supports: judgment.relation === "supports",
    confidence_meets_threshold: confident,
  };
  // Quality measures citation support, not the evaluator's confidence in its
  // own answer. A confident contradiction is low quality and a hard rejection.
  const evidence_quality = quote_present ? (judgment.relation === "supports" ? 1 : 0.2) : 0;
  return { judgment, anchor_results, evidence_quality };
}

export function createSemanticCheck(semanticEngine = askSemanticEngine) {
  if (typeof semanticEngine !== "function") throw new TypeError("semantic engine must be a function");
  const evaluations = new WeakMap();

  function evaluate(candidate) {
    if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) {
      return evaluateOnce(candidate, semanticEngine);
    }
    const existing = evaluations.get(candidate);
    if (existing) return existing;
    const pending = evaluateOnce(candidate, semanticEngine);
    evaluations.set(candidate, pending);
    return pending;
  }

  return {
    async runHardCheck(candidate) {
      const { anchor_results } = await evaluate(candidate);
      return { is_correct: Object.values(anchor_results).every(Boolean), anchor_results };
    },
    async scoreQuality(candidate) {
      return (await evaluate(candidate)).evidence_quality;
    },
  };
}

const defaultCheck = createSemanticCheck();
export const runHardCheck = defaultCheck.runHardCheck;
export const scoreQuality = defaultCheck.scoreQuality;

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
      anchor_results: { quote_present: true, relation_supports: true, confidence_meets_threshold: true },
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
    expect: { is_correct: false, quality_score: { max: 0.2 }, anchor_results: { quote_present: true, relation_supports: false } },
  },
  {
    id: "b-reject-low-confidence",
    label: "a low-confidence relation does not pass the automatic threshold",
    candidate: {
      claim: "The policy permits returns within 45 days.",
      quote: "Returns are accepted within 30 days",
      source: "Returns are accepted within 30 days when the item is unused.",
    },
    expect: { is_correct: false, quality_score: { max: 0.2 }, anchor_results: { confidence_meets_threshold: false } },
  },
  {
    id: "b-technical-semantic-service",
    label: "a semantic-service outage is a technical failure with no verdict",
    candidate: { claim: "A safe local fault fixture." },
    fault: "check_throws",
    expect: { technical_failure: { status: 500 } },
  },
];
