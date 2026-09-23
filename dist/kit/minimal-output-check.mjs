/** Recipe 0's deliberately small check: accept any non-empty output. */

function outputText(candidate) {
  if (typeof candidate === "string") return candidate;
  if (typeof candidate?.summary === "string") return candidate.summary;
  if (candidate === null || candidate === undefined) return "";
  try {
    return JSON.stringify(candidate);
  } catch {
    // Deep but valid JSON must not become a candidate-requested outage.
    return "[structured output]";
  }
}

export function runHardCheck(candidate) {
  const non_empty_output = outputText(candidate).trim() !== "";
  return { is_correct: non_empty_output, anchor_results: { non_empty_output } };
}

export function scoreQuality(candidate) {
  return Math.min(1, outputText(candidate).length / 200);
}

export const labelledCases = [
  {
    id: "recipe-0-pass-non-empty",
    label: "a non-empty output passes",
    candidate: { summary: "A concrete answer." },
    expect: { is_correct: true, anchor_results: { non_empty_output: true } },
  },
  {
    id: "recipe-0-reject-empty",
    label: "an empty output is rejected",
    candidate: { summary: "" },
    expect: { is_correct: false, quality_score: { max: 0 }, anchor_results: { non_empty_output: false } },
  },
  {
    id: "recipe-0-technical-failure",
    label: "an unavailable check is a technical failure with no verdict",
    candidate: { summary: "A safe local fault fixture." },
    fault: "check_throws",
    expect: { technical_failure: { status: 500 } },
  },
];
