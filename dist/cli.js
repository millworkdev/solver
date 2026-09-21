#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { stdin as input, stdout as output } from "node:process";
import { Solver } from "./client.js";
import { DEFAULT_API_BASE_URL, resolveDiscoveryCommand, safeBaseUrl } from "./cliDiscovery.js";
import { cliApiError, safeErrorText } from "./cliGuidance.js";
import { SolverApiError, SolverApiNetworkError } from "./errors.js";
import { createRunReplayKey, hostOneRunApprovalRequest, readHostOneRunApproval, previewRunRequest, RunAdmissionError, RunAdmissionStore, } from "./runAdmission.js";
import { resolveRunAuthorizationBoundary, unsupportedRunBoundaryReport, } from "./runAuthorizationBoundary.js";
import { claimSetupRecovery, loadSetupRecovery, setupRequestHash, setupRecoveryCommand, SetupRecoveryStorageError } from "./cliSetupRecovery.js";
import { bootstrapOrganizationKey, bootstrapOrganizationKeyInTerminal, loadStoredOrganizationKey } from "./cliOrganizationKeyBootstrap.js";
import { inspectCommand, inspectionApiError, inspectionQualification, InspectionUsageError, resolveInspectionCommand } from "./cliInspection.js";
import { qualificationFromApiError, qualificationFromPlan, qualifyMissingCredential, } from "./cliQualification.js";
import { POOL_STARTER_CONFIG_PATH, STARTER_CONFIG_PATH, STARTER_ECHO_EXAMPLE_PATH, STARTER_POOL_EXAMPLE_PATH, writeApprovedScaffold, } from "./starterScaffold.js";
import { principalScopedIdempotencyKey, progressTenantStart, tenantStartKey } from "./tenantStartFlow.js";
import { createConsentPresenter, openConsentBrowser } from "./tenantConsentBrowser.js";
import { hostedConsentUrl } from "./tenantStartFlow.js";
import { planByokChoice, byokChoice, resolveApprovedByokChoice, assertRecoveredByokChoice } from "./cliByokSelection.js";
import { resolveProviderLifecycleCommand, runProviderLifecycle, providerLifecycleSummary, ProviderInspectionError } from "./cliProviderLifecycle.js";
import { runVerifierKit } from "./cliVerifierKit.js";
import { runPreviewLines, runResultLines } from "./runResultOutput.js";
import { applicationSummary, receiptCostLines, readySetupRecovery, newSetupPlanOutput, browserHandoff, liveProofCostSummary, planCostSummary, readCreditSummary, tenantStartVerificationOnward, TENANT_START_OUTPUT_VERSION, tenantStartIsInteractive, terminalText } from "./tenantStartOutput.js";
import { acquireVerifierKeyEntry, submitVerifierIntake, trustedVerifierIntakeUrl, VERIFIER_LIFECYCLE_COMMANDS, VerifierIntakeError, VerifierLifecycleUsageError, runVerifierLifecycle, } from "./verifierLifecycleCli.js";
const cliArgs = process.argv.slice(2);
const interactive = tenantStartIsInteractive(cliArgs, Boolean(input.isTTY), Boolean(output.isTTY));
let writtenFiles;
let freshApplicationKey;
let setupRecoveryRecord;
const authenticatedPrincipalIds = new WeakMap();
function authenticatedPrincipalId(solver) {
    const cached = authenticatedPrincipalIds.get(solver);
    if (cached)
        return cached;
    const pending = solver.account.get().then((account) => {
        if (!account.authenticated_principal_id) {
            throw new Error("Millwork did not return an authenticated machine-principal identifier.");
        }
        return account.authenticated_principal_id;
    });
    authenticatedPrincipalIds.set(solver, pending);
    return pending;
}
async function defaultRequestKey(solver, operationKey) {
    return principalScopedIdempotencyKey(await authenticatedPrincipalId(solver), operationKey);
}
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
function authenticatedCommand(args) {
    return args[0] === "doctor"
        || (args[0] === "tenant" && ["start", "show"].includes(args[1] ?? ""))
        || (args[0] === "provider" && ["list", "connect", "rotate", "disconnect"].includes(args[1] ?? ""))
        || (args[0] === "models" && ["list", "use", "add"].includes(args[1] ?? ""))
        || (args[0] === "arms" && args[1] === "disable")
        || args[0] === "run"
        || (args[0] === "verifier" && ["attach", "connect", "list", "show", "test"].includes(args[1] ?? "")
            && !hasFlag(args, "--local"))
        || (args[0] === "verifier" && VERIFIER_LIFECYCLE_COMMANDS.has(args[1] ?? ""));
}
async function prepareOrganizationKey(args, tenantStart) {
    if (!authenticatedCommand(args) || process.env.SOLVERAPI_API_KEY?.trim())
        return;
    const base = safeBaseUrl(process.env.SOLVERAPI_BASE_URL);
    if (!base.valid || !base.origin)
        return;
    const stored = await loadStoredOrganizationKey(base.origin);
    if (stored) {
        process.env.SOLVERAPI_API_KEY = stored;
        return;
    }
    const planning = hasFlag(args, "--plan") || hasFlag(args, "--dry-run");
    if (!tenantStart || planning)
        return;
    const environment = process.env;
    const remote = Boolean(environment.SSH_CONNECTION || environment.SSH_CLIENT || environment.SSH_TTY);
    const automated = Boolean(environment.CI && !["0", "false"].includes(environment.CI.toLowerCase()));
    const noDesktop = process.platform === "linux" && !environment.DISPLAY && !environment.WAYLAND_DISPLAY;
    const terminalEntry = hasFlag(args, "--no-browser");
    if (automated)
        return;
    if (terminalEntry && (!interactive || cliArgs[0] !== "tenant"))
        return;
    if (!terminalEntry && ((!interactive && !hasFlag(args, "--open-browser")) || remote || noDesktop))
        return;
    if (!terminalEntry)
        process.stderr.write("Opening your browser to finish setup…\n");
    const result = await (terminalEntry ? bootstrapOrganizationKeyInTerminal : bootstrapOrganizationKey)({ apiBaseUrl: base.origin });
    if (result.state === "configured") {
        process.env.SOLVERAPI_API_KEY = result.apiKey;
        process.stderr.write("Key saved. Continuing setup…\n");
    }
    else if (result.state === "cancelled") {
        process.stderr.write("Millwork key setup cancelled. No key was saved.\n");
    }
    else if (result.state === "validation_unavailable") {
        // The terminal prompt already displayed the shared account-check notice.
    }
    else if (result.state === "expired") {
        process.stderr.write("The private local setup page expired. No key was saved.\n");
    }
    else if (result.state === "browser_unavailable") {
        process.stderr.write("The system browser could not be opened. No key was saved.\n");
    }
    else {
        process.stderr.write("Private local key setup is unavailable on this computer. No key was saved.\n");
    }
}
function emitQualification(qualification, error) {
    if (setupRecoveryRecord) {
        emitRecoveryFailure(error, qualification);
        process.exit(1);
    }
    if (interactive) {
        process.stdout.write(`Setup paused — ${terminalText(qualification.state)}.\nNext: ${terminalText(qualification.next_action.detail)}\n`);
        if (qualification.next_action.docs_url)
            process.stdout.write(`${terminalText(qualification.next_action.docs_url)}\n`);
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
function isIdempotencyConflict(error) {
    return error instanceof SolverApiError && error.status === 409 && error.type.split("/").pop() === "idempotency_conflict";
}
function approvedSetupRequest(plan, write) {
    return { digest: plan.digest, issued_at: plan.issued_at, template_id: plan.template_id,
        ...(plan.model_deployment_id ? { model_deployment_id: plan.model_deployment_id } : {}),
        ...(plan.byok_offering || plan.byok_source ? { byok_offering: plan.byok_offering ?? byokChoice(plan.byok_source) } : {}), write };
}
async function recoveryScope(solver, derivedKey) {
    return { apiBaseUrl: process.env.SOLVERAPI_BASE_URL ?? DEFAULT_API_BASE_URL,
        principalId: await authenticatedPrincipalId(solver), derivedKey };
}
function retainSetupRecovery(record) {
    setupRecoveryRecord = record;
    freshApplicationKey = record.application_key;
}
function emitRecoveryFailure(error, qualification) {
    if (!setupRecoveryRecord)
        return;
    const problem = error instanceof SolverApiError && typeof error.type !== "string" ? null : cliApiError(error);
    // A missing response can be recovered with the identical approved request.
    // A definite refusal or local blocker must be inspected before any new apply.
    const uncertain = !qualification && (error === undefined || error instanceof SolverApiNetworkError
        || (error instanceof SolverApiError && (!Number.isFinite(error.status) || error.status >= 500 || error.status === 408 || error.status === 429)));
    const command = uncertain ? setupRecoveryCommand(setupRecoveryRecord)
        : ["millwork", "tenant", "show", "--template", setupRecoveryRecord.request.template_id,
            "--idempotency-key", setupRecoveryRecord.application_key, "--json"];
    const detail = uncertain
        ? "Setup could not finish. Its request key is saved. Continue the same request with this command; do not start another setup to recover it."
        : "Setup is paused. Inspect the saved request with this read-only command, then address the reported problem before continuing. Do not repeat a rejected approval.";
    const failure = problem ?? (error ? { error: "setup_blocked", detail: safeErrorText(error instanceof Error ? error.message : String(error)) } : {});
    const nextAction = { type: uncertain ? "recover_setup" : "inspect_setup", command, detail };
    if (interactive) {
        if (problem)
            process.stderr.write(`${problem.title}\n${problem.detail ?? ""}\n${(problem.errors ?? []).map(({ field, message }) => `${field}: ${message}`).join("\n")}\nRequest ID: ${problem.request_id}\n`);
        else if (error)
            process.stderr.write(`${failure.detail}\n`);
        if (qualification)
            process.stderr.write(`${terminalText(qualification.next_action.detail)}\n`);
        else if (problem)
            process.stderr.write(`${problem.next_action.detail}\n${problem.next_action.url}\n`);
        process.stderr.write(`${detail}\nRequest key: ${terminalText(setupRecoveryRecord.application_key)}\nNext: ${command.map(value => "'" + terminalText(value).replaceAll("'", "'\\''") + "'").join(" ")}\n`);
    }
    else
        emitJson({ ...failure, state: "action_required", retried_with_fresh_key: true,
            application_key: setupRecoveryRecord.application_key, next_action: nextAction,
            ...(qualification ? { qualification } : {}),
            ...(problem ? { problem_next_action: problem.next_action } : {}) });
    process.exitCode = 1;
}
async function applyApprovedPlan(solver, plan, write, idempotencyKey, keyDerivedByCli = false) {
    const blocked = qualificationFromPlan(plan);
    if (blocked)
        emitQualification(blocked);
    const request = approvedSetupRequest(plan, write);
    const apply = (key) => solver.tenantTemplates.apply({ ...request, application_key: key }, { idempotencyKey: `tenant-apply:${createHash("sha256").update(JSON.stringify([key, plan.digest])).digest("hex")}` });
    const scope = keyDerivedByCli ? await recoveryScope(solver, idempotencyKey) : undefined;
    let saved = scope ? await loadSetupRecovery(scope) : undefined;
    const useSaved = (record) => {
        retainSetupRecovery(record);
        if (record.request_sha256 !== setupRequestHash(request)) {
            throw new Error("This setup key belongs to another approved request. Recover that request before starting a new setup.");
        }
        return record.application_key;
    };
    let application;
    if (saved)
        application = await apply(useSaved(saved));
    else {
        try {
            application = await apply(idempotencyKey);
        }
        catch (error) {
            if (!scope || !isIdempotencyConflict(error))
                throw error;
            // Commit the recovery identity before sending any request under it.
            // Concurrent callers read the same complete record, retained after success.
            saved = await claimSetupRecovery(scope, request);
            const key = useSaved(saved);
            process.stderr.write(`This request key conflicts with an earlier request. Retrying with a saved key.\nRequest key: ${terminalText(key)}\nIf you need to retry, use --idempotency-key '${terminalText(key)}' with the same request.\n`);
            application = await apply(key);
        }
    }
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
async function promptLine(question) {
    const rl = createInterface({ input, output: process.stderr });
    try {
        return (await rl.question(terminalText(question))).trim();
    }
    finally {
        rl.close();
    }
}
async function chooseByokOffering(offerings) {
    process.stderr.write("Choose your provider and model. Your provider bills model usage; Millwork charges its displayed live-run fee.\n");
    offerings.forEach((item, index) => process.stderr.write(`${index + 1}. ${terminalText(item.source_id)} — ${terminalText(item.model_key)} (${terminalText(item.served_variant_id)})${item.source_id === "aws_bedrock" ? item.auth_scheme === "api_key" ? " — Bedrock API key" : " — advanced AWS STS" : ""}\n`));
    const rl = createInterface({ input, output: process.stderr });
    try {
        const answer = (await rl.question("Choice number (Enter to cancel): ")).trim();
        if (!answer)
            return undefined;
        const index = Number(answer) - 1;
        if (!/^\d+$/.test(answer) || !Number.isSafeInteger(index) || index < 0 || index >= offerings.length) {
            throw new InspectionUsageError("Choose one listed number. No provider was selected or connected.");
        }
        return offerings[index];
    }
    finally {
        rl.close();
    }
}
async function finishApplication(solver, initial, recovered = false) {
    const setupRecovery = recovered ? readySetupRecovery(initial, hasFlag(cliArgs, "--no-browser")) : undefined;
    let previous = "";
    const consent = createConsentPresenter({ interactive, noBrowser: hasFlag(cliArgs, "--no-browser"),
        explicitOpenBrowser: hasFlag(cliArgs, "--open-browser"),
        write: (message) => { process.stderr.write(message); } });
    const initialUrl = hostedConsentUrl(initial);
    if (!interactive && hasFlag(cliArgs, "--open-browser") && initialUrl)
        await consent.presentConsent(initial, initialUrl);
    const application = await progressTenantStart(solver.tenantTemplates, initial, {
        interactive,
        presentConsent: consent.presentConsent,
        approveConsentRetry: async () => confirm("Provider connection did not complete. Open a fresh approval for this saved setup? No paid run starts. [y/N] "),
        progress: (current) => {
            consent.progress(current);
            const marker = `${current.state}:${current.next_action.type}`;
            if (interactive && marker !== previous && !setupRecovery) {
                process.stderr.write(`Application ${terminalText(current.application_id)}: ${terminalText(current.state)}\n${terminalText(current.next_action.detail)}\n`);
            }
            previous = marker;
        },
        approveLive: async (current) => {
            process.stderr.write(liveProofCostSummary(current));
            return confirm("Authorize this exact bounded live proof? [y/N] ");
        },
    });
    const verification = tenantStartVerificationOnward(application);
    const extras = { ...(setupRecovery ? { setup_recovery: setupRecovery } : {}), ...(writtenFiles ? { files: writtenFiles } : {}),
        ...(freshApplicationKey ? { retried_with_fresh_key: true, application_key: freshApplicationKey } : {}),
        ...(verification ? { verification } : {}) };
    let selection;
    if (application.state === "ready" && application.managed_arm_id
        && application.selected_model_deployment_id) {
        selection = await solver.tenantTemplates.select(application.application_id, {
            idempotencyKey: await defaultRequestKey(solver, `tenant-model-select:${application.application_id}`),
        });
        if (interactive)
            process.stderr.write(`Current model: ${terminalText(selection.managed_arm_id)}\n`);
    }
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
        emitJson({ ...application, ...extras, ...(selection ? { selection } : {}),
            ...(browserHandoff(application) ? { human_handoff: browserHandoff(application) } : {}) });
    // Retaining a failed execution is not successful onboarding. Keep the
    // recovery document, but let scripts detect the terminal failure too.
    if (application.state === "failed_safe"
        || (application.state === "action_required" && application.next_action.type === "retry_consent"))
        process.exitCode = 1;
    return application;
}
function assertCommandFlags(args, start, booleans, values, allowPositionals = false) {
    for (let index = start; index < args.length; index += 1) {
        const argument = args[index];
        if (booleans.has(argument))
            continue;
        if (values.has(argument)) {
            if (!args[index + 1] || args[index + 1].startsWith("--")) {
                throw new InspectionUsageError(`${argument} requires a value`);
            }
            index += 1;
            continue;
        }
        if (!argument.startsWith("--")) {
            if (allowPositionals)
                continue;
            throw new InspectionUsageError(`unexpected argument: ${terminalText(argument)}`);
        }
        throw new InspectionUsageError(`unknown argument: ${terminalText(argument)}`);
    }
}
function resolveCatalogModel(rows, requested, deploymentId) {
    const candidates = rows.filter((row) => deploymentId
        ? row.deployment.model_deployment_id === deploymentId
        : row.model.model_key === requested || row.deployment.model_deployment_id === requested);
    if (candidates.length === 0)
        throw new InspectionUsageError(`No usable certified catalog model matches ${terminalText(deploymentId ?? requested)}. Run millwork models list.`);
    if (candidates.length > 1) {
        const choices = candidates.map((row) => `${row.deployment.model_deployment_id} (${row.connection.access_lane})`).join(", ");
        throw new InspectionUsageError(`That model has multiple usable routes. Re-run with --model-deployment-id: ${terminalText(choices)}`);
    }
    return candidates[0];
}
async function runPlannedModelApplication(solver, input) {
    const saved = input.applicationKeyDerivedByCli ? await loadSetupRecovery(await recoveryScope(solver, input.applicationKey)) : undefined;
    if (saved)
        retainSetupRecovery(saved);
    const recovered = await solver.tenantTemplates.recover({
        template_id: input.templateId,
        idempotency_key: saved?.application_key ?? input.applicationKey,
    });
    if (recovered.application) {
        if (input.modelDeploymentId
            && recovered.application.selected_model_deployment_id !== input.modelDeploymentId) {
            throw new InspectionUsageError("The saved application belongs to a different deployment. Use a different --idempotency-key.");
        }
        await finishApplication(solver, recovered.application, Boolean(saved));
        return;
    }
    if (saved) {
        emitRecoveryFailure();
        return;
    }
    if (!interactive) {
        emitJson({ state: "action_required", next_action: {
                type: "interactive_approval_required",
                detail: "Run this command in an interactive terminal to review the exact plan and authorize any browser consent or bounded live proof.",
            } });
        process.exit(2);
    }
    const plan = await solver.tenantTemplates.plan({
        template_id: input.templateId,
        ...(input.modelDeploymentId ? { model_deployment_id: input.modelDeploymentId } : {}),
    });
    const blocked = qualificationFromPlan(plan);
    if (blocked)
        emitQualification(blocked);
    process.stderr.write(planCostSummary(plan));
    process.stderr.write(`Plan digest ${terminalText(plan.digest)}\nLane ${terminalText(plan.access_lane)}\nModel ${terminalText(plan.catalog_row?.model.model_key ?? "unavailable")}\nDeployment ${terminalText(plan.catalog_row?.deployment.model_deployment_id ?? "unavailable")}\nMaximum spend USD ${terminalText(plan.maximum_spend_usd)}\n`);
    if (!await confirm(input.approvalQuestion(plan))) {
        process.stdout.write("cancelled\n");
        return;
    }
    const application = await applyApprovedPlan(solver, {
        ...plan,
        ...(plan.catalog_row ? { model_deployment_id: plan.catalog_row.deployment.model_deployment_id } : {}),
    }, false, input.applicationKey, input.applicationKeyDerivedByCli);
    await finishApplication(solver, application);
}
async function runModelUse(solver, args) {
    assertCommandFlags(args, 3, new Set(["--json", "--no-browser"]), new Set(["--model-deployment-id", "--idempotency-key"]));
    const requested = args[2];
    if (!requested || requested.startsWith("--"))
        throw new InspectionUsageError("usage: millwork models use <catalog-model> [--model-deployment-id <id>]");
    const row = resolveCatalogModel((await solver.modelCatalog.get()).models, requested, flagValue(args, "--model-deployment-id"));
    const templateId = row.connection.access_lane === "byok" ? "byok-open-model" : "pooled-open-model";
    const explicitApplicationKey = flagValue(args, "--idempotency-key");
    await runPlannedModelApplication(solver, {
        templateId,
        modelDeploymentId: row.deployment.model_deployment_id,
        applicationKey: explicitApplicationKey
            ?? await defaultRequestKey(solver, `tenant-model-use:${row.deployment.model_deployment_id}`),
        applicationKeyDerivedByCli: !explicitApplicationKey,
        approvalQuestion: (plan) => templateId === "byok-open-model"
            ? "Connect this customer-owned route, prove the exact new arm, and select it only after success? [y/N] "
            : `Test this exact hosted arm with a spending allowance of USD ${plan.maximum_spend_usd} and select it only after success? An in-flight model call can exceed its budget. [y/N] `,
    });
}
async function runModelAdd(solver, args) {
    assertCommandFlags(args, 3, new Set(["--json", "--yes"]), new Set(["--model-deployment-id", "--idempotency-key"]));
    const requested = args[2];
    if (!requested || requested.startsWith("--"))
        throw new InspectionUsageError("usage: millwork models add <catalog-model> [--model-deployment-id <id>]");
    const row = resolveCatalogModel((await solver.modelCatalog.get()).models, requested, flagValue(args, "--model-deployment-id"));
    if (!hasFlag(args, "--yes") && (!interactive || !await confirm(`Add ${row.model.model_key} as another ready arm without changing the current model? [y/N] `))) {
        process.stdout.write(interactive ? "cancelled\n" : `${JSON.stringify({ state: "action_required", next_action: "re-run with --yes" })}\n`);
        if (!interactive)
            process.exitCode = 2;
        return;
    }
    const outcome = await solver.arms.create(row.arm_registration_template, {
        idempotencyKey: flagValue(args, "--idempotency-key")
            ?? await defaultRequestKey(solver, `models-add:${row.deployment.model_deployment_id}`),
    });
    if (interactive)
        process.stdout.write(`Added arm ${terminalText(outcome.arm_id)} — ${terminalText(outcome.status)}. Current selection unchanged.\n`);
    else
        emitJson({ operation: "models_add", ...outcome, selection_changed: false });
}
async function runArmDisable(solver, args) {
    assertCommandFlags(args, 3, new Set(["--json", "--yes"]), new Set(["--idempotency-key"]));
    const armId = args[2];
    if (!armId || armId.startsWith("--"))
        throw new InspectionUsageError("usage: millwork arms disable <arm-id> [--yes]");
    const current = await solver.tenantTemplates.current();
    const warning = current?.managed_arm_id === armId
        ? "This is the current model; disabling it will leave no runnable default."
        : "This keeps history and does not change another selected model.";
    if (!hasFlag(args, "--yes") && (!interactive || !await confirm(`Disable ${armId}? ${warning} [y/N] `))) {
        process.stdout.write(interactive ? "cancelled\n" : `${JSON.stringify({ state: "action_required", next_action: "re-run with --yes" })}\n`);
        if (!interactive)
            process.exitCode = 2;
        return;
    }
    const outcome = await solver.arms.disable(armId, {
        idempotencyKey: flagValue(args, "--idempotency-key")
            ?? await defaultRequestKey(solver, `arms-disable:${armId}`),
    });
    if (interactive)
        process.stdout.write(`Disabled arm ${terminalText(outcome.arm_id)}. ${terminalText(warning)}\n`);
    else
        emitJson({ operation: "arms_disable", ...outcome, was_current: current?.managed_arm_id === armId });
}
const uncheckedProbeSection = { status: "not_checked", correction: null };
function contractCheckFailed(report) {
    if (report.feedback?.response_compatibility?.status !== "ok")
        return true;
    return report.contract?.validated !== true;
}
function probeFacts(report, declaration) {
    return {
        reachable: report.feedback?.reachability ?? uncheckedProbeSection,
        authentication: report.feedback?.authentication ?? uncheckedProbeSection,
        response_contract: report.feedback?.response_compatibility ?? uncheckedProbeSection,
        declaration: {
            status: declaration?.status ?? "not_declared",
            statement: declaration?.statement ?? "Not declared",
        },
    };
}
function connectionHeadline(status, report) {
    if (contractCheckFailed(report))
        return "not_ready";
    return status;
}
function connectionHeadlineCopy(headline, facts) {
    if (headline === "ready")
        return "Connection tested. Review a run with this check.";
    if (facts.reachable.status === "failed")
        return "We could not reach your check.";
    if (facts.authentication.status === "failed")
        return "Your check did not accept this key.";
    return "Access connected. The check's response needs a fix.";
}
function writeProbeFacts(facts, headline) {
    const line = (label, section) => section.correction
        ? `${label}: ${section.status} — ${section.correction}`
        : `${label}: ${section.status}`;
    process.stdout.write(`Reachable: ${facts.reachable.status}${facts.reachable.correction ? ` — ${facts.reachable.correction}` : ""}\n`
        + `${line("Authentication", facts.authentication)}\n`
        + `${line("Response contract", facts.response_contract)}\n`
        + `Declaration: ${facts.declaration.status} — ${facts.declaration.statement}\n`
        + `Compatibility: ${headline === "ready" ? "usable" : "not usable"}.\n`);
}
function parseAccessMode(args) {
    const access = flagValue(args, "--access");
    if (access === undefined)
        return undefined;
    if (access === "public" || access === "managed")
        return access;
    throw new InspectionUsageError("--access must be public or managed");
}
async function resolveAccessMode(args) {
    const explicit = parseAccessMode(args);
    if (explicit)
        return explicit;
    if (flagValue(args, "--intent-id") || flagValue(args, "--stop-days") !== undefined
        || flagValue(args, "--stop-date") !== undefined)
        return "managed";
    if (flagValue(args, "--verifier-id") && !flagValue(args, "--endpoint"))
        return "managed";
    if (!interactive) {
        emitJson({
            operation: "verifier_connect",
            state: "action_required",
            next_action: "pass --access public for a credential-less endpoint, or --access managed for a protected adapter key",
        });
        process.exitCode = 2;
        return undefined;
    }
    const managed = await confirm("Does this check require an adapter credential Millwork will hold? [y/N] ");
    return managed ? "managed" : "public";
}
function parseVerifierDataClass(args) {
    const dataClass = (flagValue(args, "--data-class") ?? "public");
    if (!new Set(["public", "sandbox", "tenant_internal"]).has(dataClass)) {
        throw new InspectionUsageError("--data-class must be public, sandbox, or tenant_internal");
    }
    return dataClass;
}
async function registerEndpointVerifier(solver, args, endpoint, authRef, operationKeyPrefix = "verifier-register", operationKeyMaterial = `${authRef}\0${endpoint}`) {
    const dataClass = parseVerifierDataClass(args);
    return solver.verifiers.create({
        display_name: flagValue(args, "--name") ?? "Millwork verifier",
        version: flagValue(args, "--version") ?? "1",
        kind: "endpoint",
        endpoint: { url: endpoint, auth_ref: authRef },
        input_data_classes: [dataClass],
        scoring: { correctness: "boolean_anchors", quality: "scalar_0_1" },
        ...(hasFlag(args, "--declare-deterministic")
            ? { correctness_declaration: { method: "deterministic" } }
            : {}),
    }, {
        idempotencyKey: flagValue(args, "--idempotency-key")
            ?? await defaultRequestKey(solver, `${operationKeyPrefix}:${createHash("sha256").update(operationKeyMaterial).digest("hex")}`),
    });
}
async function runVerifierAttach(solver, args) {
    assertCommandFlags(args, 2, new Set(["--json", "--yes", "--declare-deterministic"]), new Set(["--name", "--version", "--endpoint", "--auth-ref", "--data-class", "--idempotency-key"]));
    const endpoint = flagValue(args, "--endpoint");
    const authRef = flagValue(args, "--auth-ref");
    if (!endpoint || !authRef)
        throw new InspectionUsageError("verifier attach requires --endpoint <https-url> and --auth-ref <credential-handle>");
    if (!hasFlag(args, "--yes") && (!interactive || !await confirm(`Attach and probe verifier endpoint ${endpoint}? [y/N] `))) {
        process.stdout.write(interactive ? "cancelled\n" : `${JSON.stringify({ state: "action_required", next_action: "re-run with --yes" })}\n`);
        if (!interactive)
            process.exitCode = 2;
        return;
    }
    const outcome = await registerEndpointVerifier(solver, args, endpoint, authRef, "verifier-attach", endpoint);
    const facts = probeFacts(outcome.preflight, outcome.correctness_declaration);
    const headline = connectionHeadline(outcome.status, outcome.preflight);
    if (interactive) {
        process.stdout.write(`Verifier ${terminalText(outcome.verifier_id)} — ${terminalText(headline)}.\n`);
        writeProbeFacts(facts, headline);
    }
    else {
        emitJson({ operation: "verifier_attach", verifier_id: outcome.verifier_id, hash: outcome.hash,
            status: outcome.status, headline, facts, preflight: outcome.preflight,
            correctness_declaration: outcome.correctness_declaration });
    }
    if (headline !== "ready")
        process.exitCode = 1;
}
async function runPublicVerifierConnect(solver, args) {
    const endpoint = flagValue(args, "--endpoint");
    let verifierId = flagValue(args, "--verifier-id");
    if (!verifierId && !endpoint) {
        throw new InspectionUsageError("credential-less verifier connect requires --endpoint <https-url> or --verifier-id");
    }
    let outcome;
    if (!verifierId && endpoint) {
        if (!hasFlag(args, "--name") || !hasFlag(args, "--version")) {
            if (!interactive) {
                emitJson({
                    operation: "verifier_connect",
                    state: "action_required",
                    next_action: "pass --name and --version; registration metadata is not guessed",
                });
                process.exitCode = 2;
                return;
            }
            const name = flagValue(args, "--name") ?? "Millwork verifier";
            const version = flagValue(args, "--version") ?? "1";
            if (!await confirm(`Register this check as ${name} version ${version} with no adapter credential? [y/N] `)) {
                process.stdout.write("cancelled\n");
                return;
            }
        }
        outcome = await registerEndpointVerifier(solver, args, endpoint, "");
        verifierId = outcome.verifier_id;
    }
    else {
        outcome = await solver.verifiers.test(verifierId, {
            idempotencyKey: flagValue(args, "--idempotency-key")
                ?? await defaultRequestKey(solver, `verifier-test:${verifierId}`),
        });
    }
    const report = "preflight" in outcome ? outcome.preflight : outcome.probe;
    const facts = probeFacts(report, outcome.correctness_declaration);
    const headline = connectionHeadline(outcome.status, report);
    const connection = {
        access: "public",
        verifier_id: verifierId,
        status: outcome.status,
        headline,
        facts,
        probe: report,
        correctness_declaration: outcome.correctness_declaration,
    };
    if (interactive) {
        process.stdout.write(`${connectionHeadlineCopy(headline, facts)}\nVerifier ${terminalText(verifierId)}.\n`);
        writeProbeFacts(facts, headline);
    }
    if (headline !== "ready") {
        if (!interactive)
            emitJson({ operation: "verifier_connect", ...connection });
        process.exitCode = 1;
        return;
    }
    if (hasFlag(args, "--connect-only")) {
        if (interactive)
            process.stdout.write("Check connected. No run started.\n");
        else
            emitJson({ operation: "verifier_connect", ...connection });
        return;
    }
    await continueConnectedVerifierRun(solver, args, verifierId, connection);
}
async function continueConnectedVerifierRun(solver, args, verifierId, connection) {
    let objective = flagValue(args, "--objective");
    if (!objective) {
        if (interactive) {
            objective = await promptLine("What should the first run do? (Enter to stop after connecting): ");
            if (!objective) {
                process.stdout.write("Check connected. No run started.\n");
                return;
            }
        }
        else {
            emitJson({
                operation: "verifier_connect",
                ...connection,
                state: "action_required",
                next_action: "re-run with --objective to preview the first governed run, or --connect-only to stop after connect",
            });
            process.exitCode = 2;
            return;
        }
    }
    const suppliedPreset = flagValue(args, "--preset");
    const usesExplicitRunBounds = flagValue(args, "--arm-id") && flagValue(args, "--max-cost-usd") && flagValue(args, "--max-runtime-s");
    const currentPreset = !suppliedPreset && !usesExplicitRunBounds
        ? (await solver.tenantTemplates.current())?.request_preset_id
        : undefined;
    await runExecution(solver, [
        "run",
        "--verifier-id", verifierId,
        "--objective", objective,
        ...(suppliedPreset ?? currentPreset ? ["--preset", (suppliedPreset ?? currentPreset)] : []),
        ...(flagValue(args, "--arm-id") ? ["--arm-id", flagValue(args, "--arm-id")] : []),
        ...(flagValue(args, "--max-cost-usd") ? ["--max-cost-usd", flagValue(args, "--max-cost-usd")] : []),
        ...(flagValue(args, "--max-runtime-s") ? ["--max-runtime-s", flagValue(args, "--max-runtime-s")] : []),
        ...(flagValue(args, "--data-class") ? ["--data-class", flagValue(args, "--data-class")] : []),
        ...(hasFlag(args, "--json") ? ["--json"] : []),
    ], { connection });
}
function connectionStatusLabel(status) {
    switch (status) {
        case "active": return "Connected";
        case "revoked": return "Disconnected";
        case "expired": return "Stop date passed";
        case "unknown": return "Could not confirm the connection";
        case "unbound": return "Not connected";
    }
}
function connectionStopLine(connection) {
    if (!connection.stop_at)
        return null;
    const remaining = connection.days_remaining === null
        ? ""
        : ` · ${connection.days_remaining} ${connection.days_remaining === 1 ? "day" : "days"} remaining`;
    return `Millwork will stop using this key at ${terminalText(connection.stop_at)} (${terminalText(connection.stop_time_zone ?? "UTC")})${remaining}.`;
}
async function runVerifierList(solver, args) {
    assertCommandFlags(args, 2, new Set(["--json"]), new Set(["--cursor", "--limit"]));
    const limit = flagValue(args, "--limit");
    const page = await solver.verifiers.list({
        cursor: flagValue(args, "--cursor"),
        ...(limit ? { limit: Number(limit) } : {}),
    });
    if (interactive) {
        if (page.items.length === 0)
            process.stdout.write("No checks registered. Connect one with millwork verifier connect --endpoint <https-url> --access public.\n");
        for (const row of page.items) {
            const connection = row.connection;
            const stop = connection ? connectionStopLine(connection) : null;
            const status = connection ? connectionStatusLabel(connection.status) : "Could not confirm the connection";
            process.stdout.write(`${terminalText(row.verifier_id)}  ${terminalText(row.display_name)}  ${terminalText(row.version)}  ${status}${stop ? `  ${stop}` : ""}\n`);
        }
        if (page.nextCursor)
            process.stdout.write(`Next page: millwork verifier list --cursor ${page.nextCursor}\n`);
        return;
    }
    emitJson({ operation: "verifier_list", verifiers: page.items, next_cursor: page.nextCursor });
}
async function runVerifierShow(solver, args) {
    assertCommandFlags(args, 2, new Set(["--json"]), new Set(["--verifier-id"]));
    const verifierId = flagValue(args, "--verifier-id") ?? args[2];
    if (!verifierId || verifierId.startsWith("--")) {
        throw new InspectionUsageError("verifier show requires --verifier-id <id>");
    }
    const row = await solver.verifiers.get(verifierId);
    if (interactive) {
        const connection = row.connection;
        const stopped = connection?.stopped_at ? ` at ${terminalText(connection.stopped_at)}` : "";
        const reason = connection?.stop_reason === "origin_invalidated"
            ? "Endpoint address changed. Restore with a new key for the current endpoint."
            : connection?.stop_reason === "stop_date"
                ? "The selected Millwork stop date passed. Restore with a new key to reconnect."
                : connection?.stop_reason === "revoked"
                    ? "Disconnected in Millwork. The key may still work at the endpoint."
                    : null;
        const schedule = connection ? connectionStopLine(connection) : null;
        const connectionStatus = connection ? connectionStatusLabel(connection.status) : "Could not confirm the connection";
        process.stdout.write(`${terminalText(row.verifier_id)}\n${terminalText(row.display_name)} ${terminalText(row.version)}\n`
            + `Endpoint: ${terminalText(row.endpoint.url)}\n`
            + `Connection: ${connectionStatus}${stopped}\n`
            + (schedule ? `${schedule}\n` : "")
            + (reason ? `Next step: ${reason}\n` : "")
            + `Declaration: ${row.correctness_declaration?.status ?? "not_declared"}\n`);
        return;
    }
    emitJson({ operation: "verifier_show", ...row });
}
async function runVerifierRetest(solver, args) {
    assertCommandFlags(args, 2, new Set(["--json"]), new Set(["--verifier-id", "--idempotency-key"]));
    const verifierId = flagValue(args, "--verifier-id") ?? args[2];
    if (!verifierId || verifierId.startsWith("--")) {
        throw new InspectionUsageError("verifier test requires --verifier-id <id>");
    }
    const report = await solver.verifiers.test(verifierId, {
        idempotencyKey: flagValue(args, "--idempotency-key")
            ?? await defaultRequestKey(solver, `verifier-test:${verifierId}`),
    });
    const facts = probeFacts(report.probe, report.correctness_declaration);
    const headline = connectionHeadline(report.status, report.probe);
    if (interactive) {
        process.stdout.write(`Verifier ${terminalText(report.verifier_id)} — ${terminalText(headline)}.\n`);
        writeProbeFacts(facts, headline);
    }
    else {
        emitJson({ operation: "verifier_test", verifier_id: report.verifier_id, status: report.status,
            headline, facts, probe: report.probe, correctness_declaration: report.correctness_declaration });
    }
    if (headline !== "ready")
        process.exitCode = 1;
}
function validCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validTimeZone(value) {
    try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
    }
    catch {
        return false;
    }
}
async function verifierStopChoice(args) {
    let days = flagValue(args, "--stop-days");
    let date = flagValue(args, "--stop-date");
    let timeZone = flagValue(args, "--time-zone");
    if (days !== undefined && (date !== undefined || timeZone !== undefined)) {
        throw new InspectionUsageError("Use --stop-days or --stop-date with --time-zone, not both");
    }
    if (days === undefined && date === undefined) {
        if (!interactive) {
            throw new InspectionUsageError("Choose --stop-days <30|90|180|365|0> or --stop-date <YYYY-MM-DD> --time-zone <IANA-zone>");
        }
        process.stderr.write("When should Millwork stop using this key? Enter 30, 90, 180, 365, 0 for no stop date, or YYYY-MM-DD: ");
        const answer = (await readLineUnmuted()).trim();
        if (validCalendarDate(answer))
            date = answer;
        else
            days = answer;
    }
    if (date !== undefined) {
        if (!validCalendarDate(date))
            throw new InspectionUsageError("--stop-date must be a real calendar date in YYYY-MM-DD form");
        if (timeZone === undefined && interactive) {
            const local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
            process.stderr.write(`Time zone for ${date} [${local}]: `);
            timeZone = (await readLineUnmuted()).trim() || local;
        }
        if (!timeZone || !validTimeZone(timeZone)) {
            throw new InspectionUsageError("--time-zone must be an IANA time zone when --stop-date is used");
        }
        return { kind: "calendar_date", date, time_zone: timeZone };
    }
    const count = Number(days);
    if (count === 0)
        return { kind: "no_expiration" };
    if (count === 30 || count === 90 || count === 180 || count === 365)
        return { kind: "preset_days", days: count };
    throw new InspectionUsageError("--stop-days must be 30, 90, 180, 365, or 0 for no Millwork stop date");
}
function verifierStopChoiceLabel(choice) {
    if (choice.kind === "no_expiration")
        return "none";
    if (choice.kind === "preset_days")
        return `${choice.days} days after the key is saved`;
    return `${choice.date} (${choice.time_zone})`;
}
async function runVerifierConnect(solver, args) {
    assertCommandFlags(args, 2, new Set(["--json", "--yes", "--connect-only", "--declare-deterministic", "--open-browser", "--no-browser"]), new Set([
        "--verifier-id", "--endpoint", "--name", "--version", "--data-class", "--stop-days", "--stop-date", "--time-zone", "--idempotency-key", "--intent-id",
        "--access", "--objective", "--preset", "--arm-id", "--max-cost-usd", "--max-runtime-s",
    ]));
    const access = await resolveAccessMode(args);
    if (!access)
        return;
    if (access === "public")
        return runPublicVerifierConnect(solver, args);
    let verifierId = flagValue(args, "--verifier-id");
    const endpoint = flagValue(args, "--endpoint");
    const resumeIntentId = flagValue(args, "--intent-id");
    if (!verifierId && !endpoint && !resumeIntentId)
        throw new InspectionUsageError("verifier connect requires --verifier-id, --endpoint, or --intent-id");
    if (!verifierId && endpoint) {
        const dataClass = (flagValue(args, "--data-class") ?? "public");
        const created = await solver.verifiers.create({
            display_name: flagValue(args, "--name") ?? "Millwork verifier",
            version: flagValue(args, "--version") ?? "1",
            kind: "endpoint",
            endpoint: { url: endpoint, auth_ref: "" },
            input_data_classes: [dataClass],
            scoring: { correctness: "boolean_anchors", quality: "scalar_0_1" },
        }, { idempotencyKey: flagValue(args, "--idempotency-key")
                ?? await defaultRequestKey(solver, `verifier-connect:${createHash("sha256").update(endpoint).digest("hex")}`) });
        verifierId = created.verifier_id;
    }
    if (!verifierId)
        throw new InspectionUsageError("verifier connect resume requires --verifier-id with --intent-id");
    if (hasFlag(args, "--open-browser") && hasFlag(args, "--no-browser")) {
        throw new InspectionUsageError("--open-browser and --no-browser cannot be used together");
    }
    const stopChoice = resumeIntentId ? undefined : await verifierStopChoice(args);
    const intent = resumeIntentId
        ? {
            continue_url: "",
            intent_id: resumeIntentId,
            origin: "",
            expires_at: "",
        }
        : await solver.verifierConnection.createIntent(verifierId, stopChoice, {
            idempotencyKey: flagValue(args, "--idempotency-key"),
        });
    const resumed = resumeIntentId
        ? await recoverStagedVerifierIntake(solver, verifierId, intent.intent_id)
        : undefined;
    let staged = resumed?.kind === "recovered" ? resumed.staged : undefined;
    if (resumeIntentId && resumed?.kind !== "recovered") {
        if (resumed?.kind === "not_entered") {
            emitVerifierConnectProblem(verifierId, {
                state: "action_required",
                nextAction: "enter_key",
                reason: "No key has been entered for this setup yet. Enter it on the private page first, then run this command again.",
            });
        }
        else {
            emitVerifierConnectProblem(verifierId, {
                state: "unknown",
                nextAction: "wait_then_recover_same_intent",
                reason: "We could not confirm whether the key was saved. Do not enter it again. Wait, then continue this setup:",
                next: verifierIntentRecoveryCommand(verifierId, intent.intent_id),
            });
        }
        process.exitCode = 2;
        return;
    }
    if (!staged) {
        let continueUrl;
        try {
            continueUrl = trustedVerifierIntakeUrl(intent.continue_url, process.env.CUSTOMER_APP_ORIGIN
                ?? ("intake_origin" in intent ? intent.intake_origin : undefined)
                ?? new URL(process.env.SOLVERAPI_BASE_URL ?? DEFAULT_API_BASE_URL).origin);
        }
        catch {
            emitVerifierConnectProblem(verifierId, {
                state: "refused", nextAction: "inspect_server_configuration",
                reason: "The server returned an invalid key-entry URL. Inspect the server configuration before starting a new intent.",
            });
            process.exitCode = 2;
            return;
        }
        if (intent.origin && interactive)
            process.stdout.write(`Destination origin: ${intent.origin}\n`);
        if (interactive && stopChoice)
            process.stdout.write(`Millwork stop date: ${verifierStopChoiceLabel(stopChoice)}\n`);
        const acquired = await acquireVerifierKeyEntry({
            args,
            interactive,
            continueUrl: continueUrl.href,
            expiresAt: intent.expires_at,
            existingSecret: process.env.VERIFIER_CONNECTION_SECRET,
            readSecret: readMutedVerifierSecret,
            recover: () => recoverStagedVerifierIntake(solver, verifierId, intent.intent_id).then((result) => result.kind === "not_entered" ? { kind: "pending" } : result),
            openBrowser: openConsentBrowser,
            out: (text) => process.stdout.write(text),
            err: (text) => process.stderr.write(text),
        });
        if (acquired.kind === "staged")
            staged = acquired.staged;
        if (!staged && acquired.kind === "resume") {
            emitVerifierConnectResume(verifierId, intent);
            process.exitCode = 2;
            return;
        }
        const secret = acquired.kind === "secret" ? acquired.secret : undefined;
        if (!staged)
            try {
                staged = await submitVerifierIntake({
                    url: continueUrl,
                    secret: secret,
                    apiKey: process.env.SOLVERAPI_API_KEY,
                });
            }
            catch (error) {
                if (!(error instanceof VerifierIntakeError))
                    throw error;
                const recovered = error.mayHaveCommitted
                    ? await recoverStagedVerifierIntake(solver, verifierId, intent.intent_id)
                    : undefined;
                staged = recovered?.kind === "recovered" ? recovered.staged : undefined;
                if (!staged) {
                    if (error.failure === "rate_limited") {
                        const wait = error.retryAfterSeconds;
                        const next = stopChoice === undefined ? undefined : newVerifierIntentCommand(verifierId, stopChoice);
                        emitVerifierConnectProblem(verifierId, {
                            state: "retry_required",
                            nextAction: next ? "start_new_intent" : "choose_stop_period_then_start_new_intent",
                            reason: wait === null
                                ? `Too many key-entry requests. Try again later${next ? " with:" : " and choose a stop period (30, 90, 180, 365, or 0)."}`
                                : `Too many key-entry requests. Wait at least ${wait} seconds, then try again${next ? " with:" : " and choose a stop period (30, 90, 180, 365, or 0)."}`,
                            next,
                            retryAfterSeconds: wait,
                        });
                    }
                    else if (error.failure === "admission_refused") {
                        emitVerifierConnectProblem(verifierId, {
                            state: "refused",
                            nextAction: "request_tenant_admission",
                            reason: "Your organization does not currently have access to the private preview. Contact Millwork support to restore or request access, then try again.",
                        });
                    }
                    else if (error.failure === "authentication_refused") {
                        const next = stopChoice === undefined ? undefined : newVerifierIntentCommand(verifierId, stopChoice);
                        emitVerifierConnectProblem(verifierId, {
                            state: "refused",
                            nextAction: next ? "start_new_intent" : "choose_stop_period_then_start_new_intent",
                            reason: next
                                ? "The key-entry request was refused. Use the API key that created the intent, then start a new intent with:"
                                : "The key-entry request was refused. Use the API key that created the intent, then choose a stop period (30, 90, 180, 365, or 0) and start a new intent.",
                            next,
                        });
                    }
                    else if (error.failure === "request_refused") {
                        const next = stopChoice === undefined ? undefined : newVerifierIntentCommand(verifierId, stopChoice);
                        emitVerifierConnectProblem(verifierId, {
                            state: "refused",
                            nextAction: next ? "start_new_intent" : "choose_stop_period_then_start_new_intent",
                            reason: next
                                ? "The key-entry request was refused before the key could be saved. Check the entered value, then start a new intent with:"
                                : "The key-entry request was refused before the key could be saved. Check the entered value, then choose a stop period (30, 90, 180, 365, or 0) and start a new intent.",
                            next,
                        });
                    }
                    else {
                        emitVerifierConnectProblem(verifierId, {
                            state: "unknown",
                            nextAction: "recover_same_intent",
                            reason: "We could not confirm whether the key was saved. Do not enter it again. Wait, then continue this setup:",
                            next: verifierIntentRecoveryCommand(verifierId, intent.intent_id),
                        });
                    }
                    process.exitCode = 2;
                    return;
                }
            }
    }
    await solver.verifierConnection.testAndPromote(verifierId, {
        handle: staged.handle,
        captured_generation: staged.captured_generation,
    });
    const connection = await solver.verifierConnection.inspect(verifierId);
    if (interactive) {
        const stop = connectionStopLine(connection) ?? "No Millwork stop date.";
        process.stdout.write(`Verifier ${terminalText(verifierId)} connected. ${stop}\n`);
    }
    else
        emitJson({ operation: "verifier_connect", verifier_id: verifierId, ...connection });
    if (interactive && !hasFlag(args, "--connect-only")) {
        await continueConnectedVerifierRun(solver, args, verifierId, {
            access: "managed", verifier_id: verifierId, ...connection,
        });
    }
}
/**
 * The command that finishes an entered key is `verifier continue`: it reads
 * this exact operation back and tests the key entered for it. `verifier
 * connect --intent-id` re-enters the connect flow instead, which is not what
 * a caller holding a half-finished entry needs.
 */
function verifierConnectContinueCommand(verifierId, intentId) {
    return `millwork verifier continue --verifier-id ${verifierId} --intent-id ${intentId}`;
}
async function recoverStagedVerifierIntake(solver, verifierId, intentId) {
    let recovered;
    try {
        recovered = await solver.verifierConnection.inspect(verifierId, { operationKey: intentId });
    }
    catch {
        return { kind: "unknown" };
    }
    const pending = recovered.pending_key;
    const last = recovered.last_operation;
    const projectionAck = recovered.projection_ack;
    if (recovered.status === "unknown"
        || projectionAck === "unknown"
        || !Object.prototype.hasOwnProperty.call(recovered, "last_operation"))
        return { kind: "unknown" };
    if (!last)
        return { kind: "not_entered" };
    if (!pending
        || last.status !== undefined
        || last.kind !== "stage"
        || last.phase !== "admitted"
        || last.resulting_state?.handle !== pending.handle)
        return { kind: "unknown" };
    return {
        kind: "recovered",
        staged: { handle: pending.handle, captured_generation: pending.captured_generation },
    };
}
function verifierIntentRecoveryCommand(verifierId, intentId) {
    return `millwork verifier connect --verifier-id ${verifierId} --intent-id ${intentId}`;
}
function newVerifierIntentCommand(verifierId, stopChoice) {
    if (stopChoice.kind === "calendar_date") {
        return `millwork verifier connect --verifier-id ${verifierId} --stop-date ${stopChoice.date} --time-zone ${stopChoice.time_zone}`;
    }
    return `millwork verifier connect --verifier-id ${verifierId} --stop-days ${stopChoice.kind === "no_expiration" ? 0 : stopChoice.days}`;
}
function emitVerifierConnectProblem(verifierId, problem) {
    if (interactive) {
        process.stderr.write(`${problem.reason}\n`);
        if (problem.next)
            process.stdout.write(`${problem.next}\n`);
        return;
    }
    emitJson({
        operation: "verifier_connect",
        state: problem.state,
        verifier_id: verifierId,
        reason: problem.reason,
        next_action: problem.nextAction,
        ...(problem.next ? { next: problem.next } : {}),
        ...(problem.retryAfterSeconds === undefined ? {} : { retry_after_seconds: problem.retryAfterSeconds }),
    });
}
function emitVerifierConnectResume(verifierId, intent, reason) {
    if (interactive) {
        if (reason)
            process.stderr.write(`${reason}\n`);
        process.stdout.write(`Open this page to enter the verifier key: ${intent.continue_url}\n`);
        if (intent.origin)
            process.stdout.write(`Destination origin: ${intent.origin}\n`);
        process.stdout.write(`Finish with: ${verifierConnectContinueCommand(verifierId, intent.intent_id)}\n`);
        return;
    }
    emitJson({
        operation: "verifier_connect",
        state: "action_required",
        verifier_id: verifierId,
        continue_url: intent.continue_url,
        intent_id: intent.intent_id,
        origin: intent.origin,
        expires_at: intent.expires_at,
        next_action: verifierConnectContinueCommand(verifierId, intent.intent_id),
        ...(reason ? { reason } : {}),
    });
}
async function readLineUnmuted() {
    const reader = createInterface({ input, output, historySize: 0 });
    try {
        return await reader.question("");
    }
    finally {
        reader.close();
    }
}
async function readMutedVerifierSecret() {
    if (!interactive || !input.isTTY || !output.isTTY || typeof input.setRawMode !== "function")
        return undefined;
    const wasRaw = input.isRaw;
    const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const reader = createInterface({ input, output: muted, terminal: true, historySize: 0 });
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort();
    reader.on("SIGINT", cancel);
    reader.on("close", cancel);
    process.on("SIGINT", cancel);
    try {
        const answer = reader.question("", { signal: cancellation.signal });
        process.stderr.write("Verifier key (hidden; Enter to use the private page instead): ");
        let secret;
        try {
            secret = await answer;
        }
        catch {
            return undefined;
        }
        process.stderr.write("\n");
        if (cancellation.signal.aborted)
            return undefined;
        return secret.trim() === "" ? undefined : secret;
    }
    finally {
        reader.close();
        process.removeListener("SIGINT", cancel);
        input.setRawMode(wasRaw);
        muted.destroy();
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const TERMINAL_EXECUTION_STATES = new Set(["completed", "failed", "cancelled", "expired"]);
function shellQuote(value) {
    return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}
function replayCommand(args, replayKey) {
    const replayArgs = [];
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--yes")
            continue;
        if (argument === "--replay-key" || argument === "--idempotency-key") {
            index += 1;
            continue;
        }
        replayArgs.push(argument);
    }
    return ["millwork", ...replayArgs, "--replay-key", replayKey].map(shellQuote).join(" ");
}
async function waitForExecution(solver, execution, maxRuntimeS) {
    const deadline = Date.now() + (maxRuntimeS + 30) * 1_000;
    let current = execution;
    while (!TERMINAL_EXECUTION_STATES.has(current.status) && Date.now() < deadline) {
        if (interactive)
            process.stderr.write(`Execution ${terminalText(current.execution_id)} — ${terminalText(current.status)}\n`);
        await sleep(1_000);
        current = await solver.executions.get(execution.execution_id);
    }
    if (!TERMINAL_EXECUTION_STATES.has(current.status)) {
        throw new Error(`Execution ${execution.execution_id} did not reach a terminal state before the local wait bound.`);
    }
    return current;
}
async function inspectExecution(solver, executionId, json) {
    const execution = await solver.executions.get(executionId);
    const terminal = TERMINAL_EXECUTION_STATES.has(execution.status);
    const result = execution.status === "completed" ? await solver.executions.result(executionId) : null;
    const receipt = terminal ? await solver.receipts.get(executionId) : null;
    if (!json && interactive) {
        process.stdout.write(`${result ? `${terminalText(result.final_text, true)}\n` : ""}Execution ${terminalText(executionId)} — ${terminalText(execution.status)}\n${receipt ? `Receipt ${terminalText(executionId)}\n${[...receiptCostLines(receipt), ...runResultLines(receipt)].map(line => `${terminalText(line)}\n`).join("")}` : "Receipt pending\n"}`);
    }
    else {
        emitJson({ operation: "run_inspect", execution, result, receipt });
    }
    if (terminal && execution.status !== "completed")
        process.exitCode = 1;
}
const UNSUPPORTED_RUN_BOUNDARY_HEADLINE = "This environment cannot authorize a paid run: nothing here is separate enough from the caller to approve spending.";
// The four parts are one arrangement, not a menu. With a read-only ledger this
// process cannot record what a standing authorization has spent, so standing
// authorization admits nothing and the host's per-run approval is the only
// authority left. Describing the parts as alternatives sent hosts away to
// configure a boundary that would still refuse every run.
const UNSUPPORTED_RUN_BOUNDARY_NEXT_ACTION = "Ask the host administrator to configure the run-authorization boundary described in the SDK README: an attestation owned by a separate principal, a read-only host admission ledger, a caller-owned recovery journal, and a host-owned one-run approval channel. A prompt, `--yes`, or a tool argument cannot replace host approval.";
function suppliedReplayKeyIntent(args) {
    return flagValue(args, "--replay-key") ?? flagValue(args, "--idempotency-key") ? "recover_same_run" : "new_run";
}
function admissionNeedsHostApproval(error) {
    return new Set([
        "missing_authorization",
        "authorization_expired",
        "authorization_revoked",
        "authorization_out_of_coverage",
        "per_run_cap_exceeded",
        "aggregate_exhausted",
        "authorization_file_invalid",
    ]).has(error.code);
}
const AUTHORITATIVE_NO_ACCEPT_PROBLEMS = new Set([
    "validation_failed",
    "echo_mode_mismatch",
    "data_class_not_available",
    "not_found",
    "invalid_state",
    "quota_exceeded",
    "insufficient_credit",
    "credit_wallet_frozen",
]);
function provesNoExecutionWasAccepted(error) {
    return AUTHORITATIVE_NO_ACCEPT_PROBLEMS.has(error.type.split("/").at(-1) ?? "");
}
function emitRunRecovery(args, grant, preview, error, outputContext = {}) {
    const command = replayCommand(args, grant.replay_key);
    if (interactive) {
        process.stderr.write(`We could not confirm this run’s outcome. Use the exact command below to inspect or resume the same run; do not start a new request:\n${command}\n`);
    }
    else {
        emitJson({ operation: "run", ...outputContext, state: "outcome_unknown", request_preview: preview,
            submission_intent: "recover_same_run", replay_key: grant.replay_key,
            replay_command: command, error: safeErrorText(error),
            next_action: { type: "replay_same_run", detail: "Run replay_command unchanged. It resumes this reservation and does not authorize a new run." } });
    }
    process.exitCode = 1;
}
async function runExecution(solver, args, outputContext = {}) {
    assertCommandFlags(args, 1, new Set(["--json", "--yes"]), new Set([
        "--preset", "--objective", "--arm-id", "--verifier-id", "--max-cost-usd",
        "--max-runtime-s", "--data-class", "--idempotency-key", "--replay-key", "--execution-id",
    ]), true);
    const executionId = flagValue(args, "--execution-id");
    if (executionId) {
        const other = ["--preset", "--objective", "--arm-id", "--verifier-id", "--max-cost-usd",
            "--max-runtime-s", "--data-class", "--idempotency-key", "--replay-key", "--yes"]
            .find(flag => hasFlag(args, flag));
        if (other || args.slice(1).some(value => !value.startsWith("--") && value !== executionId)) {
            throw new InspectionUsageError("Use millwork run --execution-id <id> [--json] by itself; inspection never submits work.");
        }
        return inspectExecution(solver, executionId, hasFlag(args, "--json"));
    }
    if (hasFlag(args, "--yes")) {
        throw new InspectionUsageError("--yes cannot authorize a paid run. Every paid run in this profile needs a host-issued one-run approval written through the host's own approval channel; a flag, a prompt answer or a tool argument is not customer spending authority. Remove --yes and run the command again to see the approval this request needs, and ask the host administrator to configure the run-authorization boundary described in the SDK README.");
    }
    if (hasFlag(args, "--idempotency-key") && hasFlag(args, "--replay-key")) {
        throw new InspectionUsageError("Pass one replay identity with --replay-key; --idempotency-key is its compatibility alias.");
    }
    const positional = args.slice(1).filter((value, index, tail) => !value.startsWith("--")
        && (index === 0 || !new Set(["--preset", "--objective", "--arm-id", "--verifier-id", "--max-cost-usd",
            "--max-runtime-s", "--data-class", "--idempotency-key", "--replay-key", "--execution-id"]).has(tail[index - 1])));
    const objective = flagValue(args, "--objective") ?? positional.join(" ");
    if (!objective)
        throw new InspectionUsageError("run requires an objective, for example: millwork run --preset <id> --objective \"Summarize this\"");
    // A malformed command is answered as a malformed command, before anything
    // about the environment is discussed.
    const requestedDataClass = flagValue(args, "--data-class");
    if (requestedDataClass !== undefined && !new Set(["public", "sandbox", "tenant_internal"]).has(requestedDataClass)) {
        throw new InspectionUsageError("--data-class must be public, sandbox, or tenant_internal");
    }
    // Nothing about this request leaves the machine until the environment can
    // show who, other than this process, is able to authorize the spending.
    const resolution = await resolveRunAuthorizationBoundary();
    if (!resolution.supported) {
        const report = unsupportedRunBoundaryReport(resolution);
        if (interactive) {
            // The JSON branch has always carried the next action; a person reading
            // this in a terminal needs the same handoff, not only the refusal.
            process.stderr.write(`${UNSUPPORTED_RUN_BOUNDARY_HEADLINE}\n${report.detail}\nChecked ${terminalText(report.attestation_file)}. Nothing was sent and no run was started.\n${UNSUPPORTED_RUN_BOUNDARY_NEXT_ACTION}\n`);
        }
        else {
            emitJson({ operation: "run", ...outputContext, state: "action_required", ...report,
                submission_intent: suppliedReplayKeyIntent(args),
                next_action: { type: "use_supported_run_authorization_boundary",
                    detail: UNSUPPORTED_RUN_BOUNDARY_NEXT_ACTION } });
        }
        process.exitCode = 2;
        return;
    }
    const boundary = resolution.boundary;
    const selection = await solver.tenantTemplates.current();
    const preset = flagValue(args, "--preset");
    const armId = flagValue(args, "--arm-id") ?? selection?.managed_arm_id;
    if (!armId)
        throw new InspectionUsageError("No current model is selected. Run millwork models use <catalog-model>, or pass --arm-id.");
    let policy;
    if (preset) {
        if (!selection || selection.request_preset_id !== preset) {
            throw new InspectionUsageError(`Preset ${terminalText(preset)} is not the current model's proved preset.`);
        }
        policy = {
            data_classes: [...selection.request_policy.data_classes],
            budget: { ...selection.request_policy.budget },
            ...(selection.request_policy.on_eval ? { on_eval: [...selection.request_policy.on_eval] } : {}),
        };
    }
    else {
        const maxCost = Number(flagValue(args, "--max-cost-usd"));
        const maxRuntime = Number(flagValue(args, "--max-runtime-s"));
        const dataClass = (flagValue(args, "--data-class") ?? "public");
        if (!Number.isFinite(maxCost) || maxCost <= 0 || !Number.isInteger(maxRuntime) || maxRuntime <= 0) {
            throw new InspectionUsageError("Without --preset, positive --max-cost-usd and --max-runtime-s are required.");
        }
        if (!new Set(["public", "sandbox", "tenant_internal"]).has(dataClass)) {
            throw new InspectionUsageError("--data-class must be public, sandbox, or tenant_internal");
        }
        policy = { data_classes: [dataClass], budget: { max_cost_usd: maxCost, max_runtime_s: maxRuntime } };
    }
    const [account, catalog, selectedArm] = await Promise.all([solver.account.get(), solver.modelCatalog.get(), solver.arms.get(armId)]);
    const model = catalog.models.find(row => row.deployment.model_deployment_id === selectedArm.model_deployment_id);
    const fee = account.billing?.platform_fee_usd_per_execution;
    const accessLane = model?.connection.access_lane;
    const providerId = model?.source.source_id;
    if (!model || !providerId || (accessLane !== "byok" && accessLane !== "millwork_pool")) {
        throw new InspectionUsageError("The selected arm's provider and paid access lane are unavailable; no run was admitted.");
    }
    const request = {
        task: { objective },
        policy,
        routing: { required_arm_id: armId },
        ...(flagValue(args, "--verifier-id") ? { verifier_id: flagValue(args, "--verifier-id") } : {}),
    };
    const preview = previewRunRequest({ account_id: account.tenant_id, request, arm_id: armId,
        provider_id: providerId, access_lane: accessLane, platform_fee_usd: fee ?? null });
    const suppliedReplayKey = flagValue(args, "--replay-key") ?? flagValue(args, "--idempotency-key");
    const submissionIntent = suppliedReplayKey ? "recover_same_run" : "new_run";
    const replayKey = suppliedReplayKey ?? createRunReplayKey(preview);
    const command = replayCommand(args, replayKey);
    const costReview = { model_key: model.model.model_key, arm_id: armId,
        source_id: model.source.source_id, access_lane: model.connection.access_lane,
        data_classes: [...policy.data_classes], max_runtime_s: policy.budget.max_runtime_s,
        platform_fee_usd: fee ?? null,
        model_budget_usd: policy.budget.max_cost_usd,
        model_usage_payer: model.connection.access_lane === "byok" ? "customer_provider_account" : "millwork_credit",
        combined_allowance_usd: preview.declared_maximum_usd,
        budget_note: "Model budget is a stop threshold, not a final quote; an in-flight call can exceed it." };
    if (interactive)
        process.stderr.write(`${runPreviewLines(request).map(line => `${terminalText(line)}\n`).join("")}Model: ${terminalText(costReview.model_key)}\nProvider: ${terminalText(providerId)}\nLane: ${terminalText(accessLane)}\nData classes: ${costReview.data_classes.map(value => terminalText(value)).join(", ")}\nRuntime limit: ${costReview.max_runtime_s}s\nMillwork platform fee: ${fee === undefined ? "unavailable; review Billing" : `USD ${fee}`}\nModel usage budget: USD ${costReview.model_budget_usd} (${costReview.model_usage_payer})\nCombined allowance: ${costReview.combined_allowance_usd === null ? "unavailable" : `USD ${costReview.combined_allowance_usd}`}\n${costReview.budget_note}\nRequest hash: ${terminalText(preview.request_hash)}\nReplay key: ${terminalText(replayKey)}${suppliedReplayKey ? "" : " (generated for this new-run request)"}\n`);
    else
        process.stderr.write(suppliedReplayKey
            ? `Replay key before submission: ${replayKey}\n`
            : `New-run replay key before submission: ${replayKey} (generated because no replay key was supplied).\n`);
    const admission = new RunAdmissionStore({ boundary });
    let grant;
    try {
        grant = await admission.admit({ preview, replayKey });
    }
    catch (error) {
        if (error instanceof RunAdmissionError && error.code === "charge_estimate_unavailable") {
            if (interactive) {
                process.stderr.write(`${error.message} Refresh account billing data before retrying; no run was admitted.\n`);
            }
            else {
                emitJson({ operation: "run", ...outputContext, state: "action_required", refusal_code: error.code,
                    cost_review: costReview, request_preview: preview, submission_intent: submissionIntent,
                    replay_key: replayKey,
                    next_action: { type: "refresh_billing_configuration", detail: "A known platform fee is required before a customer can authorize this paid run." } });
            }
            process.exitCode = 2;
            return;
        }
        if (!(error instanceof RunAdmissionError) || !admissionNeedsHostApproval(error))
            throw error;
        // Whether a person is watching this terminal is not evidence about who is
        // typing in it, so nothing here asks. The host answers, in a place this
        // process cannot write, or the run does not happen.
        const approval = await readHostOneRunApproval(boundary, preview, replayKey);
        if (!approval) {
            const requested = hostOneRunApprovalRequest(boundary, preview, replayKey);
            if (interactive) {
                process.stderr.write(requested.approval_file === null
                    // Reaching this branch already read the account, catalog and arm to
                    // price the request, so the only truthful claim left is about the
                    // paid run itself. The zero-egress claim belongs to the earlier
                    // unsupported-boundary refusal, which runs before any of that.
                    ? `${UNSUPPORTED_RUN_BOUNDARY_HEADLINE}\nThis host attests no one-run approval channel, and nothing else in this profile can admit a paid run. No paid run was submitted.\n`
                    // The approval binds this run's replay key, and a bare repeat of the
                    // original command mints a different one. The exact command is
                    // therefore printed, not described.
                    : `This run needs the host's approval, which this terminal cannot give.\nAsk the host to write ${terminalText(requested.approval_file)} with:\n${JSON.stringify(requested.document, null, 2)}\nAfter the host creates this file, run this exact command:\n${command}\nNo paid run was submitted.\n`);
            }
            else {
                emitJson({ operation: "run", ...outputContext, state: "action_required",
                    refusal_code: requested.approval_file === null ? "unsupported_run_authorization_boundary" : "host_approval_required",
                    admission_refusal_code: error.code,
                    cost_review: costReview, request_preview: preview, submission_intent: submissionIntent,
                    replay_key: replayKey, replay_command: command,
                    host_approval: requested,
                    next_action: requested.approval_file === null
                        ? { type: "use_supported_run_authorization_boundary", detail: UNSUPPORTED_RUN_BOUNDARY_NEXT_ACTION }
                        : { type: "obtain_host_one_run_approval", detail: "Ask the host administrator to create host_approval.approval_file using host_approval.document, then run replay_command unchanged." } });
            }
            process.exitCode = 2;
            return;
        }
        grant = await admission.admit({ preview, replayKey, oneRunApproval: approval });
    }
    let execution;
    if (grant.action === "inspect" && grant.execution_id) {
        execution = await solver.executions.get(grant.execution_id);
    }
    else {
        try {
            execution = await solver.executions.create(request, { idempotencyKey: replayKey });
            await admission.markAccepted(grant, execution.execution_id);
        }
        catch (error) {
            if (error instanceof SolverApiError && grant.action === "submit" && suppliedReplayKey === undefined
                && provesNoExecutionWasAccepted(error)) {
                await admission.releaseAfterAuthoritativeRefusal(grant, `HTTP ${error.status}: ${error.message}`);
                throw error;
            }
            emitRunRecovery(args, grant, preview, error, outputContext);
            return;
        }
    }
    let current;
    try {
        current = await waitForExecution(solver, execution, policy.budget.max_runtime_s);
    }
    catch (error) {
        emitRunRecovery(args, grant, preview, error, outputContext);
        return;
    }
    const result = current.status === "completed" ? await solver.executions.result(current.execution_id) : null;
    const receipt = await solver.receipts.get(current.execution_id);
    if (receipt.totals) {
        await admission.settle(grant, receipt.totals.usd + receipt.totals.platform_fee_usd);
    }
    if (interactive)
        process.stdout.write(`${result ? `${terminalText(result.final_text, true)}\n` : ""}Execution ${terminalText(current.execution_id)} — ${terminalText(current.status)}\nReceipt ${terminalText(current.execution_id)}\n${[...receiptCostLines(receipt), ...runResultLines(receipt)].map((line) => `${terminalText(line)}\n`).join("")}`);
    else
        emitJson({ operation: "run", ...outputContext, request_preview: preview, replay_key: replayKey,
            submission_intent: submissionIntent,
            replay_command: command, authorization: { kind: grant.authorization_kind, authorization_id: grant.authorization_id },
            execution: current, result, receipt });
    if (current.status !== "completed")
        process.exitCode = 1;
}
async function main() {
    // The provider command is the same durable tenant journey, not another state machine.
    const connecting = cliArgs[0] === "provider" && cliArgs[1] === "connect";
    if (connecting && (!cliArgs[2] || cliArgs[2].startsWith("--")))
        throw new InspectionUsageError("usage: millwork provider connect <source-id>. Run millwork provider list for available providers.");
    // `provider connect <id> --source-id <id>` is the same choice said twice,
    // not a conflict. Accept it when it agrees and name the disagreement when
    // it does not, instead of failing with "Duplicate argument".
    const connectTail = cliArgs.slice(3);
    if (connecting) {
        const repeated = connectTail.indexOf("--source-id");
        if (repeated !== -1) {
            const restated = connectTail[repeated + 1];
            if (restated && !restated.startsWith("--") && restated !== cliArgs[2]) {
                throw new InspectionUsageError(`This names two providers: ${cliArgs[2]} and ${restated}. Pass the source id once. Nothing was connected.`);
            }
            connectTail.splice(repeated, restated && !restated.startsWith("--") ? 2 : 1);
        }
    }
    const args = connecting ? ["tenant", "start", "--template", "byok-open-model", "--source-id", cliArgs[2], ...connectTail] : cliArgs;
    if (args.includes("--open-browser") && args.includes("--no-browser"))
        throw new InspectionUsageError("Choose --open-browser or --no-browser, not both.");
    const providerLifecycle = resolveProviderLifecycleCommand(args);
    const tenantStart = args[0] === "tenant" && args[1] === "start";
    if (tenantStart) {
        const booleanFlags = new Set(["--write", "--plan", "--dry-run", "--json", "--no-browser", "--open-browser", "--yes", "--new-setup"]);
        const valueFlags = new Set([
            "--template",
            "--model-deployment-id",
            "--source-id", "--served-variant-id", "--auth-scheme",
            "--digest",
            "--issued-at",
            "--idempotency-key",
            "--application-id",
            "--resume-action",
            "--live-proof-digest",
        ]);
        const seen = new Set();
        for (let index = 2; index < args.length; index += 1) {
            const argument = args[index];
            if (seen.has(argument))
                throw new InspectionUsageError(`Duplicate argument: ${terminalText(argument)}`);
            seen.add(argument);
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
    }
    const newSetup = hasFlag(args, "--new-setup");
    if (newSetup) {
        const conflicting = ["--application-id", "--resume-action", "--live-proof-digest", "--idempotency-key",
            "--digest", "--issued-at", "--yes", "--plan", "--dry-run"].find(flag => hasFlag(args, flag));
        if (cliArgs[0] !== "tenant" || !tenantStart || conflicting) {
            throw new InspectionUsageError(`Use tenant start --new-setup${conflicting ? ` without ${conflicting}` : ""}. It requests a fresh plan; use the returned request key and approval command to apply or retry it.`);
        }
    }
    await prepareOrganizationKey(args, tenantStart);
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
    const reconfiguration = (args[0] === "models" && (args[1] === "use" || args[1] === "add"))
        || (args[0] === "arms" && args[1] === "disable")
        || args[0] === "run"
        || (args[0] === "provider" && args[1] === "connect")
        || (args[0] === "verifier" && ["attach", "connect", "list", "show", "test"].includes(args[1] ?? "")
            && !hasFlag(args, "--local"))
        || (args[0] === "verifier" && VERIFIER_LIFECYCLE_COMMANDS.has(args[1] ?? ""));
    if (args[0] === "verifier" && (args[1] === "init" || (args[1] === "test" && hasFlag(args, "--local")))) {
        process.exitCode = await runVerifierKit(args, process.cwd(), interactive);
        return;
    }
    if (!tenantStart && !reconfiguration && !providerLifecycle) {
        process.stderr.write("usage: millwork <docs|doctor|--version|models list|models use <catalog-model>|models add <catalog-model>|arms disable <arm-id>|run --preset <id> --objective <task>|provider list|provider connect <source-id>|provider rotate <connection-id>|provider disconnect <connection-id>|verifier attach --endpoint <url> --auth-ref <handle>|verifier connect --endpoint <url> --access public|managed|verifier init|verifier test --local|verifier list|verifier show|verifier test|verifier <replace|restore|continue|disconnect> --verifier-id <id>|tenant show|tenant start> [options]\n");
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
    if (providerLifecycle) {
        const document = await runProviderLifecycle(solver, providerLifecycle, { interactive, confirm,
            write: message => process.stderr.write(terminalText(message, true)) });
        if (interactive)
            process.stdout.write(terminalText(providerLifecycleSummary(document), true));
        else
            emitJson(document);
        if (document.state === "action_required")
            process.exitCode = 2;
        return;
    }
    if (args[0] === "models" && args[1] === "use")
        return runModelUse(solver, args);
    if (args[0] === "models" && args[1] === "add")
        return runModelAdd(solver, args);
    if (args[0] === "arms" && args[1] === "disable")
        return runArmDisable(solver, args);
    if (args[0] === "run")
        return runExecution(solver, args);
    if (args[0] === "verifier" && args[1] === "attach")
        return runVerifierAttach(solver, args);
    if (args[0] === "verifier" && args[1] === "connect")
        return runVerifierConnect(solver, args);
    if (args[0] === "verifier" && args[1] === "list")
        return runVerifierList(solver, args);
    if (args[0] === "verifier" && args[1] === "show")
        return runVerifierShow(solver, args);
    if (args[0] === "verifier" && args[1] === "test")
        return runVerifierRetest(solver, args);
    if (args[0] === "verifier" && VERIFIER_LIFECYCLE_COMMANDS.has(args[1] ?? "")) {
        try {
            process.exitCode = await runVerifierLifecycle(solver, args[1], args, {
                interactive,
                out: (text) => process.stdout.write(terminalText(text, true)),
                err: (text) => process.stderr.write(terminalText(text, true)),
                emitJson,
                existingSecret: process.env.VERIFIER_CONNECTION_SECRET,
                readSecret: readMutedVerifierSecret,
                openBrowser: openConsentBrowser,
                environment: process.env,
                platform: process.platform,
                trustedIntakeOrigin: process.env.CUSTOMER_APP_ORIGIN,
                serverOrigin: new URL(process.env.SOLVERAPI_BASE_URL ?? DEFAULT_API_BASE_URL).origin,
                confirm,
                apiKey: process.env.SOLVERAPI_API_KEY,
            });
        }
        catch (error) {
            if (error instanceof VerifierLifecycleUsageError)
                throw new InspectionUsageError(error.message);
            throw error;
        }
        return;
    }
    const applicationId = flagValue(args, "--application-id");
    const resumeAction = flagValue(args, "--resume-action");
    const idempotencyKey = flagValue(args, "--idempotency-key");
    const liveProofDigest = flagValue(args, "--live-proof-digest");
    const sourceId = flagValue(args, "--source-id");
    const servedVariantId = flagValue(args, "--served-variant-id");
    const authScheme = flagValue(args, "--auth-scheme");
    if (authScheme && (sourceId !== "aws_bedrock" || !["api_key", "aws_sts_sigv4"].includes(authScheme))) {
        throw new InspectionUsageError("--auth-scheme requires --source-id aws_bedrock and api_key or aws_sts_sigv4. No method was substituted.");
    }
    const byokFilter = { ...(sourceId ? { sourceId } : {}), ...(servedVariantId ? { servedVariantId } : {}), ...(authScheme ? { authScheme } : {}) };
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
            const saved = await solver.tenantTemplates.get(applicationId);
            assertRecoveredByokChoice(saved, byokFilter);
            await finishApplication(solver, saved, true);
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
        if (sourceId || servedVariantId)
            assertRecoveredByokChoice(await solver.tenantTemplates.get(applicationId), byokFilter);
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
    if ((sourceId || servedVariantId) && templateId !== "byok-open-model")
        throw new InspectionUsageError("Provider/model choices require --template byok-open-model.");
    if (servedVariantId && !sourceId)
        throw new InspectionUsageError("--served-variant-id requires --source-id.");
    const defaultApplicationKey = idempotencyKey ? undefined : tenantStartKey(templateId, await authenticatedPrincipalId(solver));
    const applicationKey = newSetup ? `${defaultApplicationKey}:new:${randomUUID()}` : idempotencyKey ?? (sourceId
        ? `${defaultApplicationKey}:${createHash("sha256").update(JSON.stringify(byokFilter)).digest("hex")}`
        : defaultApplicationKey);
    // --new-setup keys already carry a random suffix, so only a plain derived key
    // can collide with an earlier identical plan in the same organization.
    const applicationKeyDerivedByCli = !idempotencyKey && !newSetup;
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
            if (sourceId && !servedVariantId && !modelDeploymentId)
                throw new InspectionUsageError("Applying a provider-specific plan requires its exact --served-variant-id from --plan --json.");
            const approvedChoice = sourceId && servedVariantId
                ? await resolveApprovedByokChoice(solver.tenantTemplates, { sourceId, servedVariantId, modelDeploymentId, authScheme }) : undefined;
            const application = await applyApprovedPlan(solver, {
                digest,
                issued_at: issuedAt,
                template_id: templateId,
                ...(modelDeploymentId ? { model_deployment_id: modelDeploymentId } : {}),
                ...(approvedChoice ? { byok_offering: approvedChoice } : {}),
                qualification: { state: "approved", next_action: { type: "approve_plan", detail: "" } },
                blockers: [],
                alternative_plans: [],
                file_manifest: templateId === "pooled-open-model"
                    ? DEFAULT_POOL_FILE_MANIFEST
                    : templateId === "byok-open-model"
                        ? []
                        : DEFAULT_FILE_MANIFEST,
            }, write, applicationKey, applicationKeyDerivedByCli);
            await finishApplication(solver, application);
            return;
        }
        const saved = applicationKeyDerivedByCli ? await loadSetupRecovery(await recoveryScope(solver, applicationKey)) : undefined;
        if (saved)
            retainSetupRecovery(saved);
        const recovered = newSetup ? { application: null }
            : await solver.tenantTemplates.recover({ template_id: templateId, idempotency_key: saved?.application_key ?? applicationKey });
        if (recovered.application) {
            assertRecoveredByokChoice(recovered.application, byokFilter);
            if (modelDeploymentId && recovered.application.selected_model_deployment_id !== modelDeploymentId) {
                throw new Error("The recovered application has a different deployment. Review a new explicit plan; the CLI will not silently change its model.");
            }
            if (write)
                await maybeWriteScaffold({ file_manifest: templateId === "pooled-open-model"
                        ? DEFAULT_POOL_FILE_MANIFEST : templateId === "starter" ? DEFAULT_FILE_MANIFEST : [] }, true);
            await finishApplication(solver, recovered.application, true);
            return;
        }
        if (saved) {
            emitRecoveryFailure();
            return;
        }
        if (newSetup && !interactive) {
            const plan = templateId === "byok-open-model"
                ? await planByokChoice(solver.tenantTemplates, { ...byokFilter, modelDeploymentId })
                : await solver.tenantTemplates.plan(planInput);
            if (plan)
                emitJson(newSetupPlanOutput(plan, applicationKey, write));
            process.exitCode = 2;
            return;
        }
        if (newSetup && interactive) {
            process.stderr.write(`New setup request key: ${terminalText(applicationKey)}\nKeep this key to retry with --idempotency-key if the response is lost.\n`);
        }
        if (!interactive) {
            if (templateId === "byok-open-model") {
                const plan = await planByokChoice(solver.tenantTemplates, { ...byokFilter, modelDeploymentId });
                // `provider connect` is a verb. With explicit approval it carries the
                // journey through to a connection rather than handing back a plan the
                // caller must re-apply; without --yes it still stops, because opening a
                // hosted consent application is a real side effect.
                // Approval is for one exact provider and model. Without a terminal there is
                // no prompt to resolve an ambiguous match, and --yes must not become the
                // CLI choosing on the user's behalf: it approves a decision already made,
                // never makes one.
                if (plan && hasFlag(args, "--yes") && !plan.byok_source) {
                    emitJson({ state: "action_required", plan,
                        next_action: { type: "approve_plan", detail: "More than one provider and model match. Re-run with --served-variant-id naming the exact one from byok_offerings, together with --yes. Nothing was connected." } });
                    process.exitCode = 2;
                    return;
                }
                if (plan && hasFlag(args, "--yes")) {
                    const application = await applyApprovedPlan(solver, {
                        ...plan,
                        ...(plan.catalog_row ? { model_deployment_id: plan.catalog_row.deployment.model_deployment_id } : {}),
                    }, write, applicationKey, applicationKeyDerivedByCli);
                    await finishApplication(solver, application);
                    return;
                }
                emitJson({ state: "action_required", plan,
                    next_action: { type: "approve_plan", detail: "Review this exact provider and model, then re-run the same command with --yes to connect. Nothing was connected and no paid run was started." } });
                process.exitCode = 2;
                return;
            }
            emitJson({ state: "action_required", next_action: {
                    type: "approve_plan", detail: "Run --plan --json, review its effects and digest, then apply with --digest and --issued-at. No application was created."
                } });
            process.exit(2);
        }
        const plan = templateId === "byok-open-model"
            ? await planByokChoice(solver.tenantTemplates, { ...byokFilter, modelDeploymentId }, chooseByokOffering)
            : await solver.tenantTemplates.plan(planInput);
        if (!plan) {
            process.stdout.write("cancelled\n");
            return;
        }
        const blocked = qualificationFromPlan(plan);
        if (blocked)
            emitQualification(blocked);
        process.stderr.write(planCostSummary(plan));
        process.stderr.write(`Plan digest ${terminalText(plan.digest)}\nExpires ${terminalText(plan.expires_at)}\nLane ${terminalText(plan.access_lane)}\nMaximum spend USD ${terminalText(plan.maximum_spend_usd)}\n`);
        if (plan.catalog_row) {
            process.stderr.write(`Model ${terminalText(plan.catalog_row.model.model_key)}\nDeployment ${terminalText(plan.catalog_row.deployment.model_deployment_id)}\n`);
        }
        const approved = await confirm(plan.template_id === "pooled-open-model"
            ? plan.effects?.some((effect) => effect.id === "submit_bounded_live_proof")
                ? `Authorize this exact pooled live proof with a spending allowance of USD ${plan.maximum_spend_usd}? An in-flight model call can exceed its budget. [y/N] `
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
        }, write, applicationKey, applicationKeyDerivedByCli);
        await finishApplication(solver, application);
    }
    catch (error) {
        const mapped = qualificationFromApiError(error);
        if (mapped)
            emitQualification(mapped, error);
        throw error;
    }
}
main().catch((error) => {
    if (setupRecoveryRecord) {
        emitRecoveryFailure(error, qualificationFromApiError(error) ?? undefined);
        return;
    }
    if (error instanceof SetupRecoveryStorageError && !interactive) {
        emitJson({ state: "action_required", error: "setup_recovery_unavailable",
            next_action: { type: "recover_saved_setup", detail: error.message } });
        process.exitCode = 1;
        return;
    }
    if (error instanceof ProviderInspectionError)
        emitQualification(error.qualification);
    const qualification = qualificationFromApiError(error);
    if (qualification)
        emitQualification(qualification);
    const problem = cliApiError(error);
    if (problem && !interactive)
        emitJson(problem);
    else if (problem)
        process.stderr.write(`${problem.title}\n${problem.detail ?? ""}\n${(problem.errors ?? []).map(({ field, message }) => `${field}: ${message}`).join("\n")}\nNext: ${problem.next_action.detail}\n${problem.next_action.url}\nRequest ID: ${problem.request_id}\n`);
    else
        process.stderr.write(`${safeErrorText(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(error instanceof InspectionUsageError ? 2 : 1);
});
