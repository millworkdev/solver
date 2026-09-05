import { stripVTControlCharacters } from "node:util";
import { hostedConsentUrl } from "./tenantStartFlow.js";
export const TENANT_START_OUTPUT_VERSION = "millwork.tenant-start.v1";
export function tenantStartIsInteractive(args, stdinTTY, stdoutTTY) {
    return !args.includes("--json") && stdinTTY && stdoutTTY;
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
    const echoReady = echoOnly && application.state === "ready" && application.receipt;
    const pending = ["applying", "live_queued", "live_running"].includes(application.state);
    const lines = [echoReady ? "Echo starter complete — no live model run."
            : ready ? "First live result ready."
                : `Setup ${pending ? "in progress" : "paused"} — ${terminalText(application.state)}.`,
        `Application: ${terminalText(application.application_id)}`];
    if (application.managed_arm_id)
        lines.push(`Arm: ${terminalText(application.managed_arm_id)}`);
    if (application.echo_execution_id)
        lines.push(`Echo: ${terminalText(application.echo_execution_id)} (setup test, not live proof)`);
    if (ready) {
        const provenance = extras.output.model_provenance;
        if (provenance) {
            lines.push(`Model: ${terminalText(provenance.requested.model_key)}`, `Upstream: ${terminalText(provenance.resolved?.upstream_ref ?? "not reported")}`, `Lane: ${terminalText(provenance.source.access_lane)}`, `Deployment: ${terminalText(provenance.deployment.model_deployment_id)}`);
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
        const consentUrl = hostedConsentUrl(application);
        if (consentUrl)
            lines.push(`Consent: ${terminalText(consentUrl)}`);
        if (application.consent && !consentUrl)
            lines.push("Consent link expired or unavailable; inspect the same application before explicitly retrying consent.");
        if (application.live_proof && !application.live_execution_id
            && !(Date.parse(application.live_proof.expires_at) > Date.now())) {
            lines.push("Live-proof approval expired or unavailable. Refresh readiness on this same application, then separately approve its current digest; no new live request was submitted.");
        }
        if (typeof application.diagnostics.billing_url === "string")
            lines.push(`Billing: ${terminalText(application.diagnostics.billing_url)}`);
        if (application.next_action.type === "top_up_in_billing" && !application.live_execution_id) {
            lines.push("Live execution has not started. Complete the human top-up, then rerun to review current authorization.");
        }
    }
    // Application identity, never a consent URL or secret, is the recovery handle.
    const id = terminalText(application.application_id).replace(/'/g, "'\\''");
    lines.push(`Inspect / continue: millwork tenant start --application-id '${id}'`, "For the complete machine-readable projection, add --json.");
    if (extras.files)
        lines.push(`Files: ${extras.files.written.length} written; ${extras.files.skipped_existing.length} existing files preserved.`);
    return `${lines.join("\n")}\n`;
}
