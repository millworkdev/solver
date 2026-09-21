const BUILTIN_BASELINE_VERIFIER_ID = "vrf_builtin_baseline";
const UNAVAILABLE_REASONS = {
    authentication: "The check could not authenticate.",
    credential_unavailable: "The saved key was unavailable.",
    timeout: "The check timed out.",
    network: "Millwork could not reach the check.",
    egress_rejected: "The connection was blocked by the network safety policy.",
    response_too_large: "The check returned more data than Millwork can safely accept.",
    http_error: "The check returned an unsuccessful response.",
    invalid_response: "The check response could not be read.",
    internal: "Millwork could not complete the check.",
};
const NO_EVALUATION_REASONS = {
    cancelled: "The run was cancelled before evaluation.",
    no_eligible_arms: "No eligible model was available for this slice.",
    arm_not_ready: "The selected model was not ready.",
    runtime_exceeded: "The run reached its runtime limit before evaluation.",
    cost_budget_exhausted: "The run reached its model-usage budget before evaluation.",
    fallback_exhausted: "Every eligible fallback ended before evaluation.",
    execution_terminal: "The run had already ended before evaluation could begin.",
    dispatch_timeout: "The model dispatch timed out before evaluation.",
    dispatch_network_error: "The model dispatch could not be reached before evaluation.",
    dispatch_internal_error: "The model dispatch ended before evaluation.",
    candidate_too_large: "The candidate output was too large to evaluate.",
    response_too_large: "The model response was too large to evaluate.",
    internal: "The run ended before evaluation began.",
};
function recordedAt(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function policyActionLine(action) {
    if (!action)
        return "Policy action: none recorded.";
    const copy = {
        passed_gate: "gate passed",
        fell_back: "fell back to the next eligible model",
        repair_accepted: "repaired result accepted",
        repair_rejected: "repaired result rejected",
        proposal_created: "repair proposal created for review",
    };
    return `Policy action: ${copy[action.outcome] ?? "an unrecognized recorded outcome"}${action.proposal_id ? ` (${action.proposal_id})` : ""}.`;
}
function recordedCheckLines(check) {
    if (!check)
        return [
            "Evaluation: no recorded evaluation state.",
            "Meaning: this older receipt does not support inferring a verdict, baseline result, or pending evaluation.",
        ];
    switch (check.state) {
        case "customer_verdict": {
            const anchors = Object.entries(check.anchor_results ?? {});
            return [
                `Check: ${check.verifier_id}${check.check_id ? ` (${check.check_id})` : ""}`,
                `Verdict: ${check.is_correct ? "accepted" : "rejected"}.`,
                `Quality: ${check.quality_score.toFixed(2)}.`,
                ...anchors.map(([name, passed]) => `Anchor ${name}: ${passed ? "passed" : "failed"}.`),
                `Recorded: ${recordedAt(check.recorded_at)}.`,
            ];
        }
        case "customer_unavailable":
            return [
                `Check: ${check.attempted_verifier_id}${check.check_id ? ` (${check.check_id})` : ""}`,
                "Outcome: This output could not be checked.",
                `Reason: ${UNAVAILABLE_REASONS[check.failure_class ?? ""] ?? "The check did not return a usable result."}`,
                "Verdict and quality: not recorded.",
                `Attempt recorded: ${recordedAt(check.recorded_at)}.`,
                "Next: review the check connection before retrying.",
            ];
        case "baseline":
            return [
                "Check: built-in output presence.",
                "Outcome: No customer check selected: output-presence check only.",
                `Output present: ${check.output_present ? "yes" : "no"}. This does not say whether the output is correct.`,
                `Recorded: ${recordedAt(check.recorded_at)}.`,
            ];
        case "platform_test":
            return [
                "Outcome: Platform test.",
                "Meaning: this confirms the Millwork path only; it is not a customer verdict.",
                `Recorded: ${recordedAt(check.recorded_at)}.`,
            ];
        case "pending_evaluation":
            return [
                "Evaluation: pending when recorded.",
                `Run: ${check.execution_id}.`,
                `State recorded: ${recordedAt(check.recorded_at)}.`,
                `Next: inspect this run with millwork run --execution-id ${check.execution_id}.`,
            ];
        case "terminal_no_evaluation":
            return [
                "Evaluation: No evaluation was attempted.",
                `Reason: ${NO_EVALUATION_REASONS[check.reason] ?? "The run ended before evaluation began."}`,
                `Recorded: ${recordedAt(check.recorded_at)}.`,
            ];
        case "missing_evidence":
        case "unknown_evidence":
            return [
                "Evaluation: evidence is unavailable.",
                `Run: ${check.execution_id} (${check.lifecycle_state}).`,
                `State recorded: ${recordedAt(check.recorded_at)}.`,
                `Next: inspect this run with millwork run --execution-id ${check.execution_id}.`,
            ];
    }
}
function legacyCheckLines(slice, mode) {
    if (mode === "echo") {
        return [
            "Outcome: Platform test.",
            "Meaning: this confirms the Millwork path only; it is not a customer verdict.",
            "Recorded: older receipt; check timestamp unavailable.",
        ];
    }
    const verifier = slice.verifier;
    if (verifier) {
        const verifierId = verifier.verifier_id ?? verifier.id;
        if (verifierId === BUILTIN_BASELINE_VERIFIER_ID) {
            return [
                "Check: built-in output presence.",
                "Outcome: No customer check selected: output-presence check only.",
                `Output present: ${verifier.is_correct ? "yes" : "no"}. This does not say whether the output is correct.`,
                "Recorded: older receipt; check timestamp unavailable.",
            ];
        }
        return [
            `Check: ${verifierId}`,
            `Verdict: ${verifier.is_correct ? "accepted" : "rejected"}.`,
            `Quality: ${verifier.quality_score.toFixed(2)}.`,
            ...Object.entries(verifier.anchor_results ?? {}).map(([name, passed]) => `Anchor ${name}: ${passed ? "passed" : "failed"}.`),
            "Recorded: older receipt; check timestamp unavailable.",
        ];
    }
    const failedCustomerCheck = [...(slice.verification_checks ?? [])]
        .reverse()
        .find((check) => check.activity === "customer" && check.outcome === "technical_failure");
    if (failedCustomerCheck) {
        return [
            `Check: ${failedCustomerCheck.verifier_id ?? "unknown check"} (${failedCustomerCheck.check_id})`,
            "Outcome: This output could not be checked.",
            `Reason: ${UNAVAILABLE_REASONS[failedCustomerCheck.failure_class ?? ""] ?? "The check did not return a usable result."}`,
            "Verdict and quality: not recorded.",
            "Attempt recorded: older receipt; timestamp unavailable.",
            "Next: review the check connection before retrying.",
        ];
    }
    return [
        "Evaluation: no recorded evaluation state.",
        "Meaning: this older receipt does not support inferring a verdict, baseline result, or pending evaluation.",
    ];
}
/** Customer-facing terminal detail for the receipt returned by a completed or inspected run. */
export function runResultLines(receipt) {
    const slices = receipt.slices ?? [];
    if (slices.length === 0)
        return ["Evaluation: no slice evidence was returned."];
    return slices.flatMap((slice, index) => [
        ...(slices.length > 1 ? [`Slice ${index + 1}: ${slice.slice_id}`] : []),
        ...(slice.recorded_check ? recordedCheckLines(slice.recorded_check) : legacyCheckLines(slice, receipt.mode)),
        policyActionLine(slice.acted_on_eval),
    ]);
}
/** Exact task/check/policy facts shown before the customer approves a paid run. */
export function runPreviewLines(request) {
    const onEval = request.policy.on_eval ?? [];
    return [
        `Task: ${request.task.objective}`,
        `Customer check: ${request.verifier_id ?? "none selected — built-in output presence only"}`,
        `On-evaluation policy: ${onEval.length > 0 ? onEval.join(", ") : "none"}`,
    ];
}
