import { SolverApiError } from "./errors.js";
import { qualificationFromApiError } from "./cliQualification.js";
import { tenantStartKey } from "./tenantStartFlow.js";
import { readCreditSummary, terminalText, TENANT_START_OUTPUT_VERSION } from "./tenantStartOutput.js";
const templateIds = ["pooled-open-model", "byok-open-model", "starter"];
export class InspectionUsageError extends Error {
}
/** Parse before constructing a client: a preview flag can never reach resume/apply. */
export function resolveInspectionCommand(args) {
    const kind = args[0] === "tenant" && args[1] === "show" ? "show"
        : args[0] === "models" && args[1] === "list" ? "models"
            : args[0] === "tenant" && args[1] === "start" && (args.includes("--dry-run") || args.includes("--plan")) ? "plan" : null;
    if (!kind)
        return null;
    const booleans = new Set(kind === "plan" ? ["--json", "--dry-run", "--plan"] : ["--json"]);
    const values = new Set(kind === "plan" ? ["--template", "--model-deployment-id"]
        : kind === "show" ? ["--template", "--application-id", "--idempotency-key"] : []);
    const flags = new Map();
    for (let index = 2; index < args.length; index += 1) {
        const flag = args[index];
        if (!booleans.has(flag) && !values.has(flag)) {
            throw new InspectionUsageError(`Unsupported read-only argument: ${terminalText(flag)}. Preview/inspection never applies, resumes, or writes files.`);
        }
        if (flags.has(flag))
            throw new InspectionUsageError(`Duplicate argument: ${flag}`);
        let value = "";
        if (values.has(flag)) {
            value = args[++index] ?? "";
            if (!value.trim() || value.startsWith("--"))
                throw new InspectionUsageError(`${flag} requires a value`);
        }
        flags.set(flag, value);
    }
    if (flags.has("--plan") && !flags.has("--json")) {
        throw new InspectionUsageError("--plan requires --json; planning never applies effects. Use --dry-run for a human preview.");
    }
    const template = flags.get("--template");
    if (template && !templateIds.includes(template)) {
        throw new InspectionUsageError("--template must be starter, pooled-open-model, or byok-open-model");
    }
    if (kind === "models")
        return { kind };
    if (kind === "plan")
        return { kind, templateId: (template ?? "pooled-open-model"),
            ...(flags.has("--model-deployment-id") ? { modelDeploymentId: flags.get("--model-deployment-id") } : {}) };
    if (flags.has("--application-id") && (template || flags.has("--idempotency-key"))) {
        throw new InspectionUsageError("Use --application-id alone, or --template with an optional --idempotency-key; do not mix lookup identities.");
    }
    if (flags.has("--idempotency-key") && !template) {
        throw new InspectionUsageError("A custom --idempotency-key requires --template for an exact read-only lookup.");
    }
    return { kind, ...(template ? { templateId: template } : {}),
        ...(flags.has("--application-id") ? { applicationId: flags.get("--application-id") } : {}),
        ...(flags.has("--idempotency-key") ? { applicationKey: flags.get("--idempotency-key") } : {}) };
}
export function inspectionVersion(command) {
    return command.kind === "plan" ? TENANT_START_OUTPUT_VERSION
        : command.kind === "show" ? "millwork.tenant-show.v1" : "millwork.models-list.v1";
}
export function inspectionQualification(command, qualification) {
    return { exitCode: 1, document: { ...qualification, schema_version: inspectionVersion(command), read_only: true },
        human: `Inspection unavailable — ${terminalText(qualification.state)}.\nNext: ${terminalText(qualification.next_action.detail)}\n` };
}
export function inspectionApiError(command, error) {
    // Reading a setup/catalog must not tell a reader to obtain write authority.
    if (error instanceof SolverApiError && error.status === 403)
        return inspectionQualification(command, {
            state: "role_lacks_permission", next_action: { type: "ask_owner_for_read_access",
                detail: "This credential cannot read the requested resource. Ask your tenant owner to check read access; no write permission is requested." },
        });
    const qualification = qualificationFromApiError(error);
    return qualification ? inspectionQualification(command, qualification) : null;
}
function planSummary(plan) {
    return ["Preview only — no application, consent, execution, credit grant, or files created.",
        `Template: ${terminalText(plan.template_id)} @ ${terminalText(plan.template_version)}`,
        `Preset: ${terminalText(plan.request_preset_id)}`,
        `Lane: ${terminalText(plan.access_lane)}`,
        "The effects and file manifest below describe a future approved apply, not work performed.",
        "Exact resolved plan:", terminalText(JSON.stringify(plan, null, 2), true),
        "No approval was given. Re-run tenant start only when you intend to continue setup.", ""].join("\n");
}
function creditSummary(credit) {
    return credit.status === "available" ? `Account credit: USD ${credit.balance_usd} (current wallet; not live-spend authority or provider-cost settlement)`
        : credit.status === "not_visible" ? "Account credit: not visible to this credential."
            : "Account credit: unavailable; setup inspection remains read-only.";
}
function tenantSummary(applications, credit) {
    const lines = ["Tenant setup — read-only snapshot.", creditSummary(credit)];
    if (applications.length === 0)
        lines.push("No application found for these lookup identities. Nothing was created.");
    for (const application of applications) {
        lines.push("", `Application: ${terminalText(application.application_id)} — ${terminalText(application.state)}`, `Starter: ${terminalText(application.template_id)} @ ${terminalText(application.template_version)}`, `Preset: ${terminalText(application.request_preset_id ?? "unavailable from this server / legacy application")}`, `Managed arm: ${terminalText(application.managed_arm_id ?? "not created")}`, `Deployment: ${terminalText(application.selected_model_deployment_id ?? "not selected")}`, `Echo execution: ${terminalText(application.echo_execution_id ?? "not submitted")} (diagnostic, not live proof)`, `Echo receipt: ${terminalText(application.echo_receipt_id ?? "not recorded")}`, `Live execution: ${terminalText(application.live_execution_id ?? "not submitted")}`);
        if (application.result && application.receipt && application.state === "ready") {
            lines.push(`Live result: ${terminalText(application.result.href)}`, "Verification: output presence only; not semantic correctness.");
        }
        if (application.receipt)
            lines.push(`Retained receipt: ${terminalText(application.receipt.receipt_id)} — ${terminalText(application.receipt.href)}`);
        lines.push(`Next action (not performed): ${terminalText(application.next_action.type)} — ${terminalText(application.next_action.detail)}`);
    }
    lines.push("", "No readiness refresh, consent polling, live authorization, model change, or file write was performed.", "Default lookups cover this CLI's three starter keys, not every custom application. Use --application-id for an exact snapshot.");
    return `${lines.join("\n")}\n`;
}
function modelSummary(catalog) {
    const lines = ["Usable tenant model catalog — read-only snapshot."];
    if (catalog.models.length === 0)
        lines.push("No usable certified deployments are currently visible to this tenant.", "Check source connection/certification or hosted pool readiness. No connection, arm, or fallback lane was created.");
    for (const row of catalog.models)
        lines.push("", `Model: ${terminalText(row.model.model_key)}`, `Deployment: ${terminalText(row.deployment.model_deployment_id)}`, `Lane / payer: ${terminalText(row.connection.access_lane)} / ${terminalText(row.connection.commercial_owner)}`, `Source / upstream: ${terminalText(row.source.source_id)} / ${terminalText(row.deployment.upstream_ref)}`, `Fallback: ${terminalText(row.deployment.fallback_policy)}`);
    lines.push("", "Catalog visibility is not a funding check or authorization to execute. No model was selected or changed.", "Use --json for complete certification, pricing, provenance, and registration data.");
    return `${lines.join("\n")}\n`;
}
/** Only stateless plan and GET resource methods are available to this path. */
export async function inspectCommand(command, solver, readAccount) {
    const schemaVersion = inspectionVersion(command);
    if (command.kind === "plan") {
        const plan = await solver.tenantTemplates.plan({ template_id: command.templateId,
            ...(command.modelDeploymentId ? { model_deployment_id: command.modelDeploymentId } : {}) });
        // Retain the full plan even when blocked; callers need exact blockers/effects,
        // not only a qualification summary. A blocked preview still exits nonzero.
        const blocked = plan.qualification.state !== "approved" || plan.blockers.length > 0;
        return { exitCode: blocked ? 1 : 0,
            document: { ...plan, schema_version: schemaVersion, read_only: true }, human: planSummary(plan) };
    }
    if (command.kind === "models") {
        const catalog = await solver.modelCatalog.get();
        return { exitCode: 0, document: { ...catalog, schema_version: schemaVersion, read_only: true }, human: modelSummary(catalog) };
    }
    const lookups = command.applicationId ? [{ application_id: command.applicationId }]
        : (command.templateId ? [command.templateId] : templateIds).map((templateId) => ({ template_id: templateId,
            idempotency_key: command.applicationKey ?? tenantStartKey(templateId) }));
    const applications = command.applicationId ? [await solver.tenantTemplates.get(command.applicationId)]
        : (await Promise.all(lookups.map(async (lookup) => {
            if (!("template_id" in lookup))
                throw new Error("Invalid inspection lookup");
            return (await solver.tenantTemplates.recover(lookup)).application;
        }))).filter((application) => application !== null);
    const credit = await readCreditSummary(readAccount);
    return { exitCode: 0, document: { schema_version: schemaVersion, read_only: true,
            state: applications.length ? "found" : "not_found", lookups, applications, credit },
        human: tenantSummary(applications, credit) };
}
