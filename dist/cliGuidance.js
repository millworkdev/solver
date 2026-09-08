import { SolverApiError } from "./errors.js";
import { terminalText } from "./tenantStartOutput.js";
export const API_KEYS_URL = "https://app.getmillwork.dev/keys";
export const BILLING_URL = "https://app.getmillwork.dev/billing";
export const START_DOCS_URL = "https://docs.getmillwork.dev/get-started/tenant-start";
export const KEY_GUIDANCE = `Use your organization's Millwork API key. Find an existing key, or create one if needed, at ${API_KEYS_URL} and set SOLVERAPI_API_KEY privately in the terminal running Millwork.`;
/** Support output is not a dump of request bodies, headers, or private URLs. */
export function safeErrorText(value) {
    let text = terminalText(value);
    for (const secret of [process.env.SOLVERAPI_API_KEY]) {
        if (secret)
            text = text.split(secret).join("[redacted]");
    }
    return text.replace(/(?:sk-[\w-]+|solverapi_(?:live|test)_[\w-]+|Bearer\s+\S+)/gi, "[redacted]")
        .replace(/https?:\/\/[^\s"<>]+/gi, (url) => {
        try {
            const parsed = new URL(url);
            return parsed.search || parsed.hash || parsed.username || parsed.password ? "[private URL omitted]" : url;
        }
        catch {
            return "[URL omitted]";
        }
    }).slice(0, 1200);
}
const EXPIRED_PLAN_DIGEST_DETAIL = /plan digest has expired/i;
const STALE_PLAN_FIELD = /digest|issued_at/;
export function cliApiError(error) {
    if (!(error instanceof SolverApiError))
        return null;
    const code = error.type.split("/").pop() ?? "request_failed";
    const knownCode = /^[a-z_]+$/.test(code) ? code : "request_failed";
    const fields = (error.errors ?? []).map(({ field, message }) => ({ field: safeErrorText(field), message: safeErrorText(message) }));
    const stale = (knownCode === "validation_failed" && fields.some(({ field }) => STALE_PLAN_FIELD.test(field)))
        || (knownCode === "invalid_state" && EXPIRED_PLAN_DIGEST_DETAIL.test(error.detail ?? ""));
    const model = knownCode === "validation_failed" && fields.some(({ field }) => field === "model_deployment_id");
    const next = stale
        ? { type: "refresh_plan", detail: "Request a fresh plan, review its current model, costs and effects, then approve the new digest. Do not retry the old digest.", url: `${START_DOCS_URL}#refresh-a-stale-plan` }
        : model
            ? { type: "choose_ready_model", detail: "Run millwork models list and choose a deployment available for this setup lane. Your current model was not replaced.", url: `${START_DOCS_URL}#model-not-ready-for-setup` }
            : knownCode === "insufficient_credit"
                ? { type: "top_up_in_billing", detail: "Add credit in Billing, then inspect your saved application before approving a live run.", url: BILLING_URL }
                : knownCode === "idempotency_conflict"
                    ? { type: "review_request_key", detail: "Send the original body with this request key, or choose a new --idempotency-key for intentionally new work.", url: "https://docs.getmillwork.dev/guides/errors-and-retries#safe-retry-rules" }
                    : knownCode === "permission_denied"
                        ? { type: "review_credential_context", detail: "Follow the server detail and check that this credential belongs to the intended organization. Keep the request ID if you need support.", url: "https://docs.getmillwork.dev/help/account#why-was-my-api-key-rejected" }
                        : { type: "review_error", detail: "Review the reported fields before retrying. Keep the request ID if you need support.", url: "https://docs.getmillwork.dev/guides/errors-and-retries#fix-invalid-fields" };
    return {
        state: "request_failed", error: knownCode, status: error.status,
        title: safeErrorText(error.message), ...(error.detail ? { detail: safeErrorText(error.detail) } : {}),
        ...(fields.length ? { errors: fields } : {}), request_id: safeErrorText(error.instance),
        ...(error.retryAfterS !== undefined ? { retry_after_s: error.retryAfterS } : {}), next_action: next,
    };
}
