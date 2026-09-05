import { randomUUID } from "node:crypto";
import { SolverApiError } from "./errors.js";
/** Stable, tenant-scoped server identity. No API-key hash or project file cache. */
export function tenantStartKey(template) {
    return `millwork-tenant-start:v1:${template}`;
}
/** Current hosted action only; callback/code handling stays with the authenticated host. */
export function hostedConsentUrl(application) {
    const consent = application.consent;
    if (application.template_id !== "byok-open-model" || application.state !== "consent_pending"
        || !consent || !Number.isFinite(Date.parse(consent.expires_at))
        || Date.parse(consent.expires_at) <= Date.now())
        return undefined;
    const value = consent.continue_url;
    if (typeof value !== "string" || value.length > 4096 || /\s|[\u0000-\u001f\u007f-\u009f]/u.test(value))
        return undefined;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
            return undefined;
        return parsed.href;
    }
    catch {
        return undefined;
    }
}
function isInvalidStateProblem(type) {
    try {
        const parsed = new URL(type);
        return parsed.protocol === "https:"
            && parsed.hostname === "api.getmillwork.dev"
            && parsed.pathname === "/problems/invalid_state";
    }
    catch {
        return false;
    }
}
function assertByokOwnership(application) {
    const diagnostics = application.diagnostics;
    if (diagnostics.access_lane !== "byok" || diagnostics.commercial_owner !== "customer"
        || diagnostics.lane_substitution_performed !== false) {
        throw new Error("customer-owned ownership changed or is unavailable. No other credential lane will be used.");
    }
}
function assertByokApprovalBinding(application) {
    const requested = application.diagnostics.requested;
    if (!requested || requested.access_lane !== "byok" || requested.commercial_owner !== "customer"
        || typeof application.diagnostics.source_id !== "string"
        || requested.source_id !== application.diagnostics.source_id
        || !application.source_connection_id || requested.source_connection_id !== application.source_connection_id
        || !application.selected_model_deployment_id || requested.model_deployment_id !== application.selected_model_deployment_id
        || !application.managed_arm_id || requested.required_arm_id !== application.managed_arm_id) {
        throw new Error("The customer-owned approval binding is inconsistent. Inspect the same application before authorizing a proof.");
    }
}
/** CLI orchestration only. Every durable milestone and spend gate stays server-owned. */
export async function progressTenantStart(templates, initial, options) {
    let application = initial;
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let refreshed = false;
    let approved = false;
    let displayedConsent;
    let observedExpiredConsent = false;
    const maxPolls = options.maxPolls ?? 60;
    if (!Number.isSafeInteger(maxPolls) || maxPolls < 0 || maxPolls > 300) {
        throw new Error("Progress polling must be bounded to 0–300 attempts.");
    }
    for (let poll = 0; poll <= maxPolls; poll += 1) {
        if (application.application_id !== initial.application_id || application.template_id !== initial.template_id) {
            throw new Error("Application identity changed during recovery. No other application or lane will be used.");
        }
        if (options.interactive && application.template_id === "byok-open-model")
            assertByokOwnership(application);
        options.progress(application);
        const pool = application.template_id === "pooled-open-model";
        const byok = application.template_id === "byok-open-model";
        const expired = application.live_proof
            && !(Date.parse(application.live_proof.expires_at) > Date.now());
        if (options.interactive && byok && !application.live_execution_id && application.state === "consent_pending") {
            if (poll === maxPolls || observedExpiredConsent)
                return application;
            const consent = application.consent;
            if (!consent || !Number.isFinite(Date.parse(consent.expires_at)))
                return application;
            const consentExpired = Date.parse(consent.expires_at) <= Date.now();
            // One observation lets the server record expiry. If its clock still says
            // pending, return the recovery handle rather than bursting mutation polls.
            observedExpiredConsent = consentExpired;
            if (!consentExpired) {
                const url = hostedConsentUrl(application);
                if (!url)
                    throw new Error("The hosted consent link is invalid. Inspect this application; no browser or callback was opened.");
                const marker = `${consent.handoff_intent_id}:${consent.attempt}:${url}`;
                if (marker !== displayedConsent)
                    await options.presentConsent?.(application, url);
                displayedConsent = marker;
                await sleep(2_000);
            }
            try {
                // Each observation is a new operation. Transport retries keep this key;
                // reusing it for later polls would replay the old pending projection.
                application = await templates.resume(application.application_id, { action: "poll_consent" }, { idempotencyKey: randomUUID() });
            }
            catch (error) {
                if (!(error instanceof SolverApiError) || error.status !== 409
                    || !isInvalidStateProblem(error.type))
                    throw error;
                // Another process may have consumed the same consent while we waited.
                // Recover its committed progress, not a second consent/application.
                const recovered = await templates.get(application.application_id);
                if (recovered.state === "consent_pending")
                    throw error;
                application = recovered;
            }
            continue;
        }
        if (options.interactive && (pool || byok) && !refreshed && !application.live_execution_id
            && (expired || (pool ? ["top_up_in_billing", "refresh_pool_readiness"]
                : ["refresh_byok_readiness"]).includes(application.next_action.type))) {
            refreshed = true;
            application = await templates.resume(application.application_id, { action: pool ? "refresh_pool_readiness" : "refresh_byok_readiness" }, { idempotencyKey: randomUUID() });
            continue;
        }
        if (options.interactive && (pool || byok) && !approved && !application.live_execution_id
            && application.state === "echo_proved" && application.live_proof && !expired
            && application.next_action.type === (pool ? "authorize_pool_live_proof" : "authorize_byok_live_proof")) {
            if (byok)
                assertByokApprovalBinding(application);
            // The prompt includes the current exact digest/policy. Neither a previous
            // plan approval nor a settled top-up is reusable live-spend consent.
            if (!await options.approveLive(application))
                return application;
            if (!(Date.parse(application.live_proof.expires_at) > Date.now()))
                return application;
            approved = true;
            const digest = application.live_proof.digest;
            application = await templates.resume(application.application_id, { action: "authorize_live_proof", live_proof_digest: digest }, { idempotencyKey: `tenant-live:${application.application_id}:${digest}` });
            continue;
        }
        const livePending = ["live_queued", "live_running"].includes(application.state);
        if (!livePending || poll === maxPolls)
            return application;
        await sleep(2_000);
        application = await templates.get(application.application_id);
    }
    return application;
}
