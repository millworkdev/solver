import { SolverApiError } from "./errors.js";
import { API_KEYS_URL, KEY_GUIDANCE, START_DOCS_URL } from "./cliGuidance.js";
export function qualifyMissingCredential(input) {
    if (input.apiKey?.trim())
        return null;
    return {
        state: "no_credential",
        next_action: {
            type: "configure_api_key",
            detail: KEY_GUIDANCE,
            url: API_KEYS_URL,
            docs_url: `${START_DOCS_URL}#configure-your-api-key`,
        },
    };
}
export function qualifyRejectedCredential() {
    return { state: "credential_rejected", next_action: {
            type: "replace_api_key",
            detail: `Millwork rejected this API key. It may be invalid, expired or revoked. ${KEY_GUIDANCE} This is not an admission decision.`,
            url: API_KEYS_URL, docs_url: `${START_DOCS_URL}#configure-your-api-key`,
        } };
}
export function qualifyOrganizationInviteRequired() {
    return {
        state: "organization_invite_required",
        next_action: {
            type: "ask_org_admin_to_invite",
            detail: "Ask your organization admin to invite you. This response does not confirm whether any organization exists.",
        },
    };
}
export function qualifyPreviewPendingOrRejected(status) {
    return {
        state: "preview_pending_or_rejected",
        next_action: {
            type: status === "pending" ? "wait_for_preview_decision" : "contact_support",
            detail: status === "pending"
                ? "The preview application is still pending. Wait for a decision. No tenant, session, API key, credit, pool configuration, or run was created."
                : "The preview application was rejected. Contact support. No tenant, session, API key, credit, pool configuration, or run was created.",
        },
    };
}
export function qualifyTenantNotAdmitted() {
    return {
        state: "tenant_not_admitted",
        next_action: {
            type: "contact_tenant_admin",
            detail: "This tenant is not admitted to the private preview. No tenant, session, API key, credit, pool configuration, or run was created.",
        },
    };
}
export function qualifyRoleLacksPermission(role) {
    return {
        state: "role_lacks_permission",
        next_action: {
            type: "ask_owner_for_role",
            detail: `Role ${role ?? "unknown"} cannot apply the starter template. Ask an owner to grant runs:write and arms:manage. This is not a preview-admission denial.`,
        },
    };
}
export function qualificationFromPlan(plan) {
    const state = plan.qualification?.state;
    if (state && state !== "approved") {
        return {
            state: state,
            next_action: plan.qualification.next_action,
        };
    }
    const blocker = plan.blockers?.[0];
    if (!blocker)
        return null;
    if (plan.template_id === "pooled-open-model"
        && plan.blockers.every((item) => item.code === "pool_not_entitled")
        && plan.effects?.some((effect) => effect.id === "submit_echo")
        && !plan.effects.some((effect) => effect.id === "submit_bounded_live_proof"))
        return null;
    const offeredPlan = plan.alternative_plans?.[0];
    return {
        state: blocker.code,
        next_action: blocker.next_action,
        ...(offeredPlan ? { offered_plan: offeredPlan } : {}),
    };
}
export function qualificationFromApiError(error) {
    if (!(error instanceof SolverApiError))
        return null;
    if (error.status === 401) {
        // The authentication problem code is authoritative. Do not infer an
        // admission denial or invitation requirement from arbitrary error prose.
        if (error.type.endsWith("/unauthenticated"))
            return qualifyRejectedCredential();
        if (new RegExp("\\binvit", "i").test(error.detail ?? ""))
            return qualifyOrganizationInviteRequired();
        return qualifyRejectedCredential();
    }
    // A 403 can come from role checks, human-only routes, or the idempotency
    // ledger. The problem detail is the only source that knows which one. Let
    // the normal API-error path retain that detail instead of inventing a role.
    if (error.status === 403 && error.type.endsWith("/permission_denied"))
        return null;
    const previewDecision = new RegExp("preview.*(pending|reject)|(pending|reject).*preview", "i");
    if (error.status === 409 && previewDecision.test(error.detail ?? "")) {
        const rejected = new RegExp("reject", "i").test(`${error.detail ?? ""} ${error.type}`);
        return qualifyPreviewPendingOrRejected(rejected ? "rejected" : "pending");
    }
    return null;
}
