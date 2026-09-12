import { stripVTControlCharacters } from "node:util";
import { hostedConsentUrl } from "./tenantStartFlow.js";
export const TENANT_START_OUTPUT_VERSION = "millwork.tenant-start.v1";
export function tenantStartIsInteractive(args, stdinTTY, stdoutTTY) {
    return !args.includes("--json") && stdinTTY && stdoutTTY;
}
export function planCostSummary(plan) {
    const modelBudget = plan.request_policy?.mode === "live" ? plan.request_policy.budget.max_cost_usd : 0;
    const fee = Math.max(0, Number((plan.maximum_spend_usd - modelBudget).toFixed(6)));
    const paidNow = plan.effects?.some(effect => effect.id === "submit_bounded_live_proof") === true;
    return `Model: ${terminalText(plan.catalog_row?.model.model_key ?? plan.byok_source?.model_key ?? "Echo (no provider)")}\n`
        + `Provider: ${terminalText(plan.catalog_row?.source.source_id ?? plan.byok_source?.source_id ?? "none (Echo)")}\n`
        + `Lane: ${terminalText(plan.access_lane)}\n`
        + `Data classes: ${plan.request_policy?.data_classes?.map(value => terminalText(value)).join(", ") || "not available"}\n`
        + `Runtime limit: ${plan.request_policy?.budget.max_runtime_s === undefined ? "not available" : `${plan.request_policy.budget.max_runtime_s}s`}\n`
        + `Millwork platform fee per accepted live execution: USD ${fee}\n`
        + `Model usage budget: USD ${modelBudget} — ${plan.access_lane === "byok" ? "billed by your provider, separately from Millwork credit" : "billed through Millwork credit"}\n`
        + `Combined spending allowance: USD ${plan.maximum_spend_usd}; not a final price quote.\n`
        + (modelBudget > 0 ? "The model budget is a stop threshold; an in-flight provider call can exceed it.\n" : "")
        + (paidNow ? "Applying this digest authorizes the listed live proof.\n" : "This step does not authorize a paid model run.\n");
}
/** Agents hand over a safe application ID; never copy approval URLs to chat. */
export function providerConsentAction(sourceId, authScheme) {
    if (sourceId === "openrouter")
        return { type: "provider_oauth_approval",
            detail: "Sign in to Millwork in your browser, then approve OpenRouter access. No provider key or code to copy." };
    if (sourceId === "aws_bedrock")
        return authScheme === "aws_sts_sigv4"
            ? { type: "temporary_aws_credential_entry",
                detail: "This connection uses advanced STS authentication. Sign in to Millwork and add temporary AWS credentials, their actual expiration, region and exact inference profile on its secure setup page." }
            : { type: "provider_api_key_entry",
                detail: "Sign in to Millwork and add your Bedrock API key on its secure setup page. Region is optional and defaults to us-east-1. Millwork finds the Global Opus 5 profile in your AWS account, and uses the key for up to 12 hours from submission; AWS can expire it sooner. Do not put the key in this terminal or your coding assistant." };
    if (["openai_direct", "anthropic_direct", "gemini_developer_api", "xai_direct", "moonshot_direct", "deepseek_direct", "fireworks"].includes(String(sourceId))) {
        return { type: "provider_api_key_entry", detail: "Sign in to Millwork and add your provider's API key on its secure setup page. Do not put the key in this terminal or your coding assistant." };
    }
    return { type: "provider_browser_setup", detail: "Sign in to Millwork in your browser and complete the provider setup shown there, then return to this terminal." };
}
export function browserHandoff(application) {
    if (application.state !== "consent_pending")
        return undefined;
    const action = providerConsentAction(application.diagnostics?.source_id, application.diagnostics?.auth_scheme);
    return {
        type: "human_browser_approval_required",
        action: action.type,
        source_id: typeof application.diagnostics?.source_id === "string" ? application.diagnostics.source_id : null,
        application_id: application.application_id,
        command: ["millwork", "tenant", "start", "--application-id", application.application_id],
        npx_command: ["npx", "--yes", "@millwork/solver", "tenant", "start", "--application-id", application.application_id],
        expires_at: application.consent?.expires_at ?? null,
        detail: `Ask the account holder to run the continuation command now, before expires_at. ${action.detail} Keep the consent URL private; do not paste it into shared chat. Browser setup does not authorize a paid run.`,
    };
}
export function liveProofCostSummary(application) {
    const policy = application.diagnostics.request_policy;
    const requested = application.diagnostics.requested;
    const modelBudget = policy?.budget?.max_cost_usd;
    const combined = application.diagnostics.maximum_spend_usd;
    if (typeof modelBudget !== "number" || !Number.isFinite(modelBudget)
        || typeof combined !== "number" || !Number.isFinite(combined) || combined < modelBudget) {
        return "Cost breakdown unavailable. Inspect the saved application's request policy before approving a live run.\n";
    }
    const byok = requested?.access_lane === "byok" || application.template_id === "byok-open-model";
    return `Model: ${terminalText(requested?.model_key ?? "see saved plan")}\n`
        + `Provider: ${terminalText(requested?.source_id ?? "see saved plan")}\n`
        + `Lane: ${byok ? "customer-owned — model usage billed by your provider" : "Millwork pool — model usage billed through Millwork credit"}\n`
        + `Data classes: ${Array.isArray(policy?.data_classes) ? policy.data_classes.map(value => terminalText(value)).join(", ") : "see saved plan"}\n`
        + `Runtime limit: ${typeof policy?.budget?.max_runtime_s === "number" ? `${policy.budget.max_runtime_s}s` : "see saved plan"}\n`
        + `Millwork platform fee: USD ${Number((combined - modelBudget).toFixed(6))}\n`
        + `Model usage budget: USD ${modelBudget}\nCombined spending allowance: USD ${combined}\n`
        + "The model budget is a stop threshold, not a final quote; an in-flight call can exceed it.\n"
        + `Approval digest: ${terminalText(application.live_proof?.digest)}\nExpires: ${terminalText(application.live_proof?.expires_at)}\n`;
}
/** Model output, API details and identifiers are data, never terminal commands. */
export function terminalText(value, multiline = false) {
    const text = stripVTControlCharacters(String(value ?? ""))
        .replace(/\t/g, " ")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
    return multiline ? text : text.replace(/[\n\r\u2028\u2029]/g, " ");
}
/** Do not emit billing emails, ledger activity, or a guessed zero on failure. */
export async function readCreditSummary(read) {
    try {
        const account = await read();
        if (account.balance === null)
            return { status: "not_visible" };
        const balance = account.balance?.balance_usd;
        return typeof balance === "number" && Number.isFinite(balance)
            ? { status: "available", balance_usd: balance }
            : { status: "unavailable" };
    }
    catch {
        return { status: "unavailable" };
    }
}
export function applicationSummary(application, extras) {
    const ready = application.state === "ready" && application.result && application.receipt && extras.output && extras.execution_receipt;
    const echoOnly = application.template_id === "starter";
    const echoReady = echoOnly && ["echo_proved", "ready"].includes(application.state) && application.receipt;
    const pending = ["applying", "live_queued", "live_running"].includes(application.state);
    const lines = [echoReady ? "Echo starter complete — no live model run."
            : ready ? "First live result ready."
                : `Setup ${pending ? "in progress" : "paused"} — ${terminalText(application.state)}.`,
        `Application: ${terminalText(application.application_id)}`];
    if (application.managed_arm_id)
        lines.push(`Arm: ${terminalText(application.managed_arm_id)}`);
    if (application.source_connection_id)
        lines.push(`Provider connection: ${terminalText(application.source_connection_id)}`);
    if (application.echo_execution_id)
        lines.push(`Test run (Echo): ${terminalText(application.echo_execution_id)} (no model call)`);
    if (ready) {
        const provenance = extras.output.model_provenance;
        if (provenance) {
            lines.push(`Model: ${terminalText(provenance.requested.model_key)}`, `Provider: ${terminalText(provenance.source.source_id)}`, `Upstream: ${terminalText(provenance.resolved?.upstream_ref ?? "not reported")}`, `Lane: ${terminalText(provenance.source.access_lane)}`, `Deployment: ${terminalText(provenance.deployment.model_deployment_id)}`);
        }
        const text = terminalText(extras.output.final_text, true);
        lines.push("", "Result:", ...text.slice(0, 2000).split("\n").map((line) => `  ${line}`));
        if (text.length > 2000)
            lines.push("  [Preview truncated; --json returns the full result.]");
        lines.push("", `Receipt: ${terminalText(application.receipt.receipt_id)}`, `Receipt API path: ${terminalText(application.receipt.href)}`, echoOnly ? "Verification: Echo only." : "Verification: output presence only; not semantic correctness.");
        const credit = extras.credit;
        lines.push(credit?.status === "available"
            ? `Account credit: USD ${credit.balance_usd} (current wallet; not a provider-cost settlement quote)`
            : credit?.status === "not_visible" ? "Account credit: not visible to this credential."
                : "Account credit: unavailable; the completed result and receipt are retained.");
    }
    else {
        if (echoReady)
            lines.push(`Receipt: ${terminalText(application.receipt.receipt_id)}`);
        lines.push(`Next: ${terminalText(application.next_action.type)} — ${terminalText(application.next_action.detail)}`);
        if (application.diagnostics.failure_code === "provider_insufficient_funds") {
            lines.push("Provider credit is required. Top up the provider account, not your Millwork wallet. Inspect this execution's receipt before explicitly approving a new run; no automatic retry was started.");
        }
        const consentUrl = hostedConsentUrl(application);
        if (consentUrl)
            lines.push(`Consent: ${terminalText(consentUrl)}`);
        if (application.consent && !consentUrl)
            lines.push("Consent link expired or unavailable; inspect the same application before explicitly retrying consent.");
        if (application.live_proof && !application.live_execution_id
            && !(Date.parse(application.live_proof.expires_at) > Date.now())) {
            lines.push("The spending proposal expired or is unavailable. Continue this setup to review a fresh proposal before running the model. No new live request was submitted.");
        }
        if (typeof application.diagnostics.billing_url === "string")
            lines.push(`Billing: ${terminalText(application.diagnostics.billing_url)}`);
        if (application.next_action.type === "top_up_in_billing" && !application.live_execution_id) {
            lines.push("Add Millwork credit in Billing, then continue this setup to review the paid run. The model run has not started.");
        }
    }
    // Application identity, never a consent URL or secret, is the recovery handle.
    const id = terminalText(application.application_id).replace(/'/g, "'\\''");
    lines.push(`Inspect setup (read-only): npx --yes @millwork/solver tenant show --application-id '${id}' --json`, `Continue setup: npx --yes @millwork/solver tenant start --application-id '${id}'`, "For the complete machine-readable projection, add --json.");
    if (extras.files)
        lines.push(`Files: ${extras.files.written.length} written; ${extras.files.skipped_existing.length} existing files preserved.`);
    return `${lines.join("\n")}\n`;
}
