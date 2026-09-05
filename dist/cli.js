#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Solver } from "./client.js";
import { DEFAULT_API_BASE_URL, resolveDiscoveryCommand } from "./cliDiscovery.js";
import { inspectCommand, inspectionApiError, inspectionQualification, InspectionUsageError, resolveInspectionCommand } from "./cliInspection.js";
import { qualificationFromApiError, qualificationFromPlan, qualifyMissingCredential, } from "./cliQualification.js";
import { POOL_STARTER_CONFIG_PATH, STARTER_CONFIG_PATH, STARTER_ECHO_EXAMPLE_PATH, STARTER_POOL_EXAMPLE_PATH, writeApprovedScaffold, } from "./starterScaffold.js";
import { progressTenantStart, tenantStartKey } from "./tenantStartFlow.js";
import { createConsentPresenter } from "./tenantConsentBrowser.js";
import { applicationSummary, readCreditSummary, TENANT_START_OUTPUT_VERSION, tenantStartIsInteractive, terminalText } from "./tenantStartOutput.js";
const cliArgs = process.argv.slice(2);
const interactive = tenantStartIsInteractive(cliArgs, Boolean(input.isTTY), Boolean(output.isTTY));
let writtenFiles;
function emitJson(value) {
    process.stdout.write(`${JSON.stringify({ ...value, schema_version: TENANT_START_OUTPUT_VERSION }, null, 2)}\n`);
}
const DEFAULT_FILE_MANIFEST = [
    { path: STARTER_CONFIG_PATH, kind: "secretless_config" },
    { path: ".env.example", kind: "env_placeholders" },
    { path: STARTER_ECHO_EXAMPLE_PATH, kind: "node_ts_example" },
];
const DEFAULT_POOL_FILE_MANIFEST = [
    { path: POOL_STARTER_CONFIG_PATH, kind: "secretless_config" },
    { path: ".env.example", kind: "env_placeholders" },
    { path: STARTER_POOL_EXAMPLE_PATH, kind: "node_ts_example" },
];
function flagValue(args, name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}
function hasFlag(args, name) {
    return args.includes(name);
}
function emitQualification(qualification) {
    if (interactive) {
        process.stdout.write(`Setup paused — ${terminalText(qualification.state)}.\nNext: ${terminalText(qualification.next_action.detail)}\n`);
        if (qualification.offered_plan)
            process.stdout.write(`Alternative (explicit choice, never automatic fallback): ${terminalText(qualification.offered_plan.template_id)} — ${terminalText(qualification.offered_plan.next_action.detail)}\n`);
    }
    else
        emitJson({ ...qualification });
    process.exit(1);
}
async function maybeWriteScaffold(plan, write) {
    if (!write)
        return;
    writtenFiles = await writeApprovedScaffold(process.cwd(), plan.file_manifest);
}
async function applyApprovedPlan(solver, plan, write, idempotencyKey) {
    const blocked = qualificationFromPlan(plan);
    if (blocked)
        emitQualification(blocked);
    const application = await solver.tenantTemplates.apply({
        digest: plan.digest,
        application_key: idempotencyKey,
        issued_at: plan.issued_at,
        template_id: plan.template_id,
        ...(plan.model_deployment_id
            ? { model_deployment_id: plan.model_deployment_id }
            : {}),
        write,
    }, { idempotencyKey: `tenant-apply:${createHash("sha256").update(JSON.stringify([idempotencyKey, plan.digest])).digest("hex")}` });
    await maybeWriteScaffold(plan, write);
    return application;
}
async function confirm(question) {
    const rl = createInterface({ input, output: process.stderr });
    try {
        return (await rl.question(terminalText(question))).trim().toLowerCase() === "y";
    }
    finally {
        rl.close();
    }
}
async function finishApplication(solver, initial) {
    let previous = "";
    const consent = createConsentPresenter({ interactive, noBrowser: hasFlag(cliArgs, "--no-browser"),
        write: (message) => { process.stderr.write(message); } });
    const application = await progressTenantStart(solver.tenantTemplates, initial, {
        interactive,
        presentConsent: consent.presentConsent,
        progress: (current) => {
            consent.progress(current);
            const marker = `${current.state}:${current.next_action.type}`;
            if (interactive && marker !== previous) {
                process.stderr.write(`Application ${terminalText(current.application_id)}: ${terminalText(current.state)}\n${terminalText(current.next_action.detail)}\n`);
            }
            previous = marker;
        },
        approveLive: async (current) => {
            process.stderr.write(`${terminalText(JSON.stringify({ application_id: current.application_id, live_proof: current.live_proof,
                requested: current.diagnostics.requested, request_policy: current.diagnostics.request_policy,
                maximum_spend_usd: current.diagnostics.maximum_spend_usd }, null, 2), true)}\n`);
            return confirm("Authorize this exact bounded live proof? [y/N] ");
        },
    });
    const extras = { ...(writtenFiles ? { files: writtenFiles } : {}) };
    if (application.state === "ready" && application.result && application.receipt) {
        const result = await solver.executions.result(application.result.execution_id);
        const receipt = await solver.receipts.get(application.receipt.receipt_id);
        // Optional summary read: a slow/forbidden Billing read must not hide success.
        // Reuse the account resource without changing the SDK's transport contract.
        // This dedicated reader has no caller cancellation signal; its timeout owns
        // the request lifetime and is intentionally independent of execution polling.
        const accountReader = new Solver({ apiKey: process.env.SOLVERAPI_API_KEY,
            baseUrl: process.env.SOLVERAPI_BASE_URL ?? DEFAULT_API_BASE_URL, maxRetries: 0,
            fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3_000) }) });
        Object.assign(extras, { output: result, execution_receipt: receipt,
            credit: await readCreditSummary(() => accountReader.account.get()) });
    }
    if (interactive)
        process.stdout.write(applicationSummary(application, extras));
    else
        emitJson({ ...application, ...extras });
}
async function main() {
    const args = cliArgs;
    const discovery = resolveDiscoveryCommand(args);
    if (discovery) {
        process[discovery.stream].write(`${discovery.text}\n`);
        if (discovery.exitCode !== 0)
            process.exit(discovery.exitCode);
        return;
    }
    const inspection = resolveInspectionCommand(args);
    if (inspection) {
        const missing = qualifyMissingCredential({ apiKey: process.env.SOLVERAPI_API_KEY });
        const readClient = (timeoutMs) => new Solver({ apiKey: process.env.SOLVERAPI_API_KEY,
            baseUrl: process.env.SOLVERAPI_BASE_URL ?? DEFAULT_API_BASE_URL, maxRetries: 0,
            fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }) });
        const result = missing ? inspectionQualification(inspection, missing)
            : await inspectCommand(inspection, readClient(10_000), () => readClient(3_000).account.get())
                .catch((error) => { const mapped = inspectionApiError(inspection, error); if (mapped)
                return mapped; throw error; });
        process.stdout.write(interactive ? result.human : `${JSON.stringify(result.document, null, 2)}\n`);
        process.exitCode = result.exitCode;
        return;
    }
    if (args[0] !== "tenant" || args[1] !== "start") {
        process.stderr.write("usage: millwork <docs|doctor|--version|models list [--json]|tenant show [--application-id <id> | --template <id> [--idempotency-key <key>]] [--json]|tenant start [--template starter|pooled-open-model|byok-open-model] [--model-deployment-id <id>] [--dry-run | --plan --json] [--digest <sha>] [--issued-at <iso>] [--idempotency-key <key>] [--application-id <id> --resume-action <action> [--live-proof-digest <sha>]] [--no-browser] [--write] [--json]>\n");
        process.exit(2);
    }
    const booleanFlags = new Set(["--write", "--plan", "--json", "--no-browser"]);
    const valueFlags = new Set([
        "--template",
        "--model-deployment-id",
        "--digest",
        "--issued-at",
        "--idempotency-key",
        "--application-id",
        "--resume-action",
        "--live-proof-digest",
    ]);
    for (let index = 2; index < args.length; index += 1) {
        const argument = args[index];
        if (booleanFlags.has(argument))
            continue;
        if (valueFlags.has(argument)) {
            if (!args[index + 1] || args[index + 1].startsWith("--")) {
                process.stderr.write(`${argument} requires a value\n`);
                process.exit(2);
            }
            index += 1;
            continue;
        }
        process.stderr.write(`unknown argument: ${terminalText(argument)}\n`);
        process.exit(2);
    }
    const missing = qualifyMissingCredential({
        apiKey: process.env.SOLVERAPI_API_KEY,
    });
    if (missing)
        emitQualification(missing);
    const solver = new Solver({
        apiKey: process.env.SOLVERAPI_API_KEY,
        baseUrl: process.env.SOLVERAPI_BASE_URL ?? DEFAULT_API_BASE_URL,
    });
    const applicationId = flagValue(args, "--application-id");
    const resumeAction = flagValue(args, "--resume-action");
    const idempotencyKey = flagValue(args, "--idempotency-key");
    const liveProofDigest = flagValue(args, "--live-proof-digest");
    if (applicationId || resumeAction || liveProofDigest) {
        const allowedResumeActions = new Set([
            "poll_consent",
            "retry_consent",
            "retry_connection_test",
            "retry_deployment_sync",
            "authorize_live_proof",
            "refresh_pool_readiness",
            "refresh_byok_readiness",
        ]);
        if (applicationId && !resumeAction && !liveProofDigest) {
            await finishApplication(solver, await solver.tenantTemplates.get(applicationId));
            return;
        }
        if (!applicationId || !resumeAction || !allowedResumeActions.has(resumeAction) || !idempotencyKey) {
            process.stderr.write("resume requires --application-id, a valid --resume-action, and --idempotency-key\n");
            process.exit(2);
        }
        if ((resumeAction === "authorize_live_proof") !== Boolean(liveProofDigest)) {
            process.stderr.write("--live-proof-digest is required only for authorize_live_proof\n");
            process.exit(2);
        }
        const application = await solver.tenantTemplates.resume(applicationId, {
            action: resumeAction,
            ...(liveProofDigest ? { live_proof_digest: liveProofDigest } : {}),
        }, { idempotencyKey });
        await finishApplication(solver, application);
        return;
    }
    const write = hasFlag(args, "--write");
    const templateValue = flagValue(args, "--template") ?? "pooled-open-model";
    if (templateValue !== "starter" && templateValue !== "pooled-open-model" && templateValue !== "byok-open-model") {
        process.stderr.write("--template must be starter, pooled-open-model, or byok-open-model\n");
        process.exit(2);
    }
    const templateId = templateValue;
    const applicationKey = idempotencyKey ?? tenantStartKey(templateId);
    const modelDeploymentId = flagValue(args, "--model-deployment-id");
    const planInput = {
        template_id: templateId,
        ...(modelDeploymentId ? { model_deployment_id: modelDeploymentId } : {}),
    };
    try {
        const digest = flagValue(args, "--digest");
        const issuedAt = flagValue(args, "--issued-at");
        if (Boolean(digest) !== Boolean(issuedAt)) {
            process.stderr.write("--digest and --issued-at must be supplied together\n");
            process.exit(2);
        }
        if (digest && issuedAt) {
            const application = await applyApprovedPlan(solver, {
                digest,
                issued_at: issuedAt,
                template_id: templateId,
                ...(modelDeploymentId ? { model_deployment_id: modelDeploymentId } : {}),
                qualification: { state: "approved", next_action: { type: "approve_plan", detail: "" } },
                blockers: [],
                alternative_plans: [],
                file_manifest: templateId === "pooled-open-model"
                    ? DEFAULT_POOL_FILE_MANIFEST
                    : templateId === "byok-open-model"
                        ? []
                        : DEFAULT_FILE_MANIFEST,
            }, write, applicationKey);
            await finishApplication(solver, application);
            return;
        }
        const recovered = await solver.tenantTemplates.recover({ template_id: templateId, idempotency_key: applicationKey });
        if (recovered.application) {
            if (modelDeploymentId && recovered.application.selected_model_deployment_id !== modelDeploymentId) {
                throw new Error("The recovered application has a different deployment. Review a new explicit plan; the CLI will not silently change its model.");
            }
            if (write)
                await maybeWriteScaffold({ file_manifest: templateId === "pooled-open-model"
                        ? DEFAULT_POOL_FILE_MANIFEST : templateId === "starter" ? DEFAULT_FILE_MANIFEST : [] }, true);
            await finishApplication(solver, recovered.application);
            return;
        }
        if (!interactive) {
            emitJson({ state: "action_required", next_action: {
                    type: "approve_plan", detail: "Run --plan --json, review its effects and digest, then apply with --digest and --issued-at. No application was created."
                } });
            process.exit(2);
        }
        const plan = await solver.tenantTemplates.plan(planInput);
        const blocked = qualificationFromPlan(plan);
        if (blocked)
            emitQualification(blocked);
        process.stderr.write(`Plan digest ${terminalText(plan.digest)}\nExpires ${terminalText(plan.expires_at)}\nLane ${terminalText(plan.access_lane)}\nMaximum spend USD ${terminalText(plan.maximum_spend_usd)}\n`);
        if (plan.catalog_row) {
            process.stderr.write(`Model ${terminalText(plan.catalog_row.model.model_key)}\nDeployment ${terminalText(plan.catalog_row.deployment.model_deployment_id)}\n`);
        }
        const approved = await confirm(plan.template_id === "pooled-open-model"
            ? plan.effects?.some((effect) => effect.id === "submit_bounded_live_proof")
                ? `Authorize this exact pooled live proof up to USD ${plan.maximum_spend_usd}? [y/N] `
                : "Run this exact-arm Echo only, with zero provider calls, and stop for Billing top-up? This does not authorize live spend. [y/N] "
            : plan.template_id === "byok-open-model"
                ? "Start this exact hosted customer-owned consent application? No provider key is entered in the CLI and no live request is submitted. [y/N] "
                : "Apply this zero-provider-cost Echo starter plan? [y/N] ");
        if (!approved) {
            process.stdout.write("cancelled\n");
            return;
        }
        const application = await applyApprovedPlan(solver, {
            ...plan,
            ...(plan.catalog_row
                ? { model_deployment_id: plan.catalog_row.deployment.model_deployment_id }
                : {}),
        }, write, applicationKey);
        await finishApplication(solver, application);
    }
    catch (error) {
        const mapped = qualificationFromApiError(error);
        if (mapped)
            emitQualification(mapped);
        throw error;
    }
}
main().catch((error) => {
    process.stderr.write(`${terminalText(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(error instanceof InspectionUsageError ? 2 : 1);
});
