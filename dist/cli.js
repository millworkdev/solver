#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Solver } from "./client.js";
import { DEFAULT_API_BASE_URL, resolveDiscoveryCommand } from "./cliDiscovery.js";
import { cliApiError, safeErrorText } from "./cliGuidance.js";
import { inspectCommand, inspectionApiError, inspectionQualification, InspectionUsageError, resolveInspectionCommand } from "./cliInspection.js";
import { qualificationFromApiError, qualificationFromPlan, qualifyMissingCredential, } from "./cliQualification.js";
import { POOL_STARTER_CONFIG_PATH, STARTER_CONFIG_PATH, STARTER_ECHO_EXAMPLE_PATH, STARTER_POOL_EXAMPLE_PATH, writeApprovedScaffold, } from "./starterScaffold.js";
import { principalScopedIdempotencyKey, progressTenantStart, tenantStartKey } from "./tenantStartFlow.js";
import { createConsentPresenter } from "./tenantConsentBrowser.js";
import { hostedConsentUrl } from "./tenantStartFlow.js";
import { planByokChoice, byokChoice, assertRecoveredByokChoice } from "./cliByokSelection.js";
import { resolveProviderLifecycleCommand, runProviderLifecycle, providerLifecycleSummary, ProviderInspectionError } from "./cliProviderLifecycle.js";
import { applicationSummary, browserHandoff, liveProofCostSummary, planCostSummary, readCreditSummary, TENANT_START_OUTPUT_VERSION, tenantStartIsInteractive, terminalText } from "./tenantStartOutput.js";
const cliArgs = process.argv.slice(2);
const interactive = tenantStartIsInteractive(cliArgs, Boolean(input.isTTY), Boolean(output.isTTY));
let writtenFiles;
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
function emitQualification(qualification) {
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
        ...(plan.byok_offering || plan.byok_source ? { byok_offering: plan.byok_offering ?? byokChoice(plan.byok_source) } : {}),
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
async function chooseByokOffering(offerings) {
    process.stderr.write("Choose your provider and model. Your provider bills model usage; Millwork charges its displayed live-run fee.\n");
    offerings.forEach((item, index) => process.stderr.write(`${index + 1}. ${terminalText(item.source_id)} — ${terminalText(item.model_key)} (${terminalText(item.served_variant_id)})\n`));
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
async function finishApplication(solver, initial) {
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
            if (interactive && marker !== previous) {
                process.stderr.write(`Application ${terminalText(current.application_id)}: ${terminalText(current.state)}\n${terminalText(current.next_action.detail)}\n`);
            }
            previous = marker;
        },
        approveLive: async (current) => {
            process.stderr.write(liveProofCostSummary(current));
            return confirm("Authorize this exact bounded live proof? [y/N] ");
        },
    });
    const extras = { ...(writtenFiles ? { files: writtenFiles } : {}) };
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
    const recovered = await solver.tenantTemplates.recover({
        template_id: input.templateId,
        idempotency_key: input.applicationKey,
    });
    if (recovered.application) {
        if (input.modelDeploymentId
            && recovered.application.selected_model_deployment_id !== input.modelDeploymentId) {
            throw new InspectionUsageError("The saved application belongs to a different deployment. Use a different --idempotency-key.");
        }
        await finishApplication(solver, recovered.application);
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
    }, false, input.applicationKey);
    await finishApplication(solver, application);
}
async function runModelUse(solver, args) {
    assertCommandFlags(args, 3, new Set(["--json", "--no-browser"]), new Set(["--model-deployment-id", "--idempotency-key"]));
    const requested = args[2];
    if (!requested || requested.startsWith("--"))
        throw new InspectionUsageError("usage: millwork models use <catalog-model> [--model-deployment-id <id>]");
    const row = resolveCatalogModel((await solver.modelCatalog.get()).models, requested, flagValue(args, "--model-deployment-id"));
    const templateId = row.connection.access_lane === "byok" ? "byok-open-model" : "pooled-open-model";
    await runPlannedModelApplication(solver, {
        templateId,
        modelDeploymentId: row.deployment.model_deployment_id,
        applicationKey: flagValue(args, "--idempotency-key")
            ?? await defaultRequestKey(solver, `tenant-model-use:${row.deployment.model_deployment_id}`),
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
async function runVerifierAttach(solver, args) {
    assertCommandFlags(args, 2, new Set(["--json", "--yes"]), new Set(["--name", "--version", "--endpoint", "--auth-ref", "--data-class", "--idempotency-key"]));
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
    const dataClass = (flagValue(args, "--data-class") ?? "public");
    if (!new Set(["public", "sandbox", "tenant_internal"]).has(dataClass)) {
        throw new InspectionUsageError("--data-class must be public, sandbox, or tenant_internal");
    }
    const outcome = await solver.verifiers.create({
        display_name: flagValue(args, "--name") ?? "Millwork verifier",
        version: flagValue(args, "--version") ?? "1",
        kind: "endpoint",
        endpoint: { url: endpoint, auth_ref: authRef },
        input_data_classes: [dataClass],
        scoring: { correctness: "boolean_anchors", quality: "scalar_0_1" },
    }, { idempotencyKey: flagValue(args, "--idempotency-key")
            ?? await defaultRequestKey(solver, `verifier-attach:${createHash("sha256").update(endpoint).digest("hex")}`) });
    if (interactive)
        process.stdout.write(`Verifier ${terminalText(outcome.verifier_id)} — ${terminalText(outcome.status)}.\n`);
    else
        emitJson({ operation: "verifier_attach", ...outcome });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function runExecution(solver, args) {
    assertCommandFlags(args, 1, new Set(["--json", "--yes"]), new Set([
        "--preset", "--objective", "--arm-id", "--verifier-id", "--max-cost-usd",
        "--max-runtime-s", "--data-class", "--idempotency-key",
    ]), true);
    const positional = args.slice(1).filter((value, index, tail) => !value.startsWith("--")
        && (index === 0 || !new Set(["--preset", "--objective", "--arm-id", "--verifier-id", "--max-cost-usd",
            "--max-runtime-s", "--data-class", "--idempotency-key"]).has(tail[index - 1])));
    const objective = flagValue(args, "--objective") ?? positional.join(" ");
    if (!objective)
        throw new InspectionUsageError("run requires an objective, for example: millwork run --preset <id> --objective \"Summarize this\"");
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
    const costReview = { model_key: model?.model.model_key ?? null, arm_id: armId,
        source_id: model?.source.source_id ?? null, access_lane: model?.connection.access_lane ?? null,
        data_classes: [...policy.data_classes], max_runtime_s: policy.budget.max_runtime_s,
        platform_fee_usd: fee ?? null,
        model_budget_usd: policy.budget.max_cost_usd,
        model_usage_payer: model?.connection.access_lane === "byok" ? "customer_provider_account" : model ? "millwork_credit" : "not_available",
        combined_allowance_usd: fee === undefined ? null : Number((fee + policy.budget.max_cost_usd).toFixed(6)),
        budget_note: "Model budget is a stop threshold, not a final quote; an in-flight call can exceed it." };
    if (interactive)
        process.stderr.write(`Model: ${terminalText(costReview.model_key ?? "not available")}\nProvider: ${terminalText(costReview.source_id ?? "not available")}\nLane: ${terminalText(costReview.access_lane ?? "not available")}\nData classes: ${costReview.data_classes.map(value => terminalText(value)).join(", ")}\nRuntime limit: ${costReview.max_runtime_s}s\nMillwork platform fee: ${fee === undefined ? "unavailable; review Billing" : `USD ${fee}`}\nModel usage budget: USD ${costReview.model_budget_usd} (${costReview.model_usage_payer})\nCombined allowance: ${costReview.combined_allowance_usd === null ? "unavailable" : `USD ${costReview.combined_allowance_usd}`}\n${costReview.budget_note}\n`);
    if (!hasFlag(args, "--yes") && (!interactive || !await confirm(`Run exact arm ${armId} with a model budget of USD ${policy.budget.max_cost_usd} and ${policy.budget.max_runtime_s}s runtime? An in-flight model call can exceed its budget. [y/N] `))) {
        process.stdout.write(interactive ? "cancelled\n" : `${JSON.stringify({ state: "action_required", cost_review: costReview,
            next_action: { type: "approve_run", detail: "Review this exact model, provider, lane, data classes, runtime limit and costs with the user. Only after spending approval, rerun with --yes. --json is output formatting, not spending permission." } })}\n`);
        if (!interactive)
            process.exitCode = 2;
        return;
    }
    const execution = await solver.executions.create({
        task: { objective },
        policy,
        routing: { required_arm_id: armId },
        ...(flagValue(args, "--verifier-id") ? { verifier_id: flagValue(args, "--verifier-id") } : {}),
    }, { idempotencyKey: flagValue(args, "--idempotency-key")
            ?? `run:${createHash("sha256").update(JSON.stringify([objective, armId, Date.now()])).digest("hex")}` });
    const deadline = Date.now() + (policy.budget.max_runtime_s + 30) * 1_000;
    let current = execution;
    while (!["completed", "failed", "cancelled", "expired"].includes(current.status) && Date.now() < deadline) {
        await sleep(1_000);
        current = await solver.executions.get(execution.execution_id);
    }
    if (!["completed", "failed", "cancelled", "expired"].includes(current.status)) {
        throw new Error(`Execution ${execution.execution_id} did not reach a terminal state before the local wait bound. Inspect it; no retry was started.`);
    }
    const result = current.status === "completed" ? await solver.executions.result(current.execution_id) : null;
    const receipt = await solver.receipts.get(current.execution_id);
    if (interactive)
        process.stdout.write(`${result ? `${terminalText(result.final_text, true)}\n` : ""}Execution ${terminalText(current.execution_id)} — ${terminalText(current.status)}\nReceipt ${terminalText(current.execution_id)}\n`);
    else
        emitJson({ operation: "run", execution: current, result, receipt });
    if (current.status !== "completed")
        process.exitCode = 1;
}
async function main() {
    // The provider command is the same durable tenant journey, not another state machine.
    const connecting = cliArgs[0] === "provider" && cliArgs[1] === "connect";
    if (connecting && (!cliArgs[2] || cliArgs[2].startsWith("--")))
        throw new InspectionUsageError("usage: millwork provider connect <source-id>. Run millwork provider list for available providers.");
    const args = connecting ? ["tenant", "start", "--template", "byok-open-model", "--source-id", cliArgs[2], ...cliArgs.slice(3)] : cliArgs;
    if (args.includes("--open-browser") && args.includes("--no-browser"))
        throw new InspectionUsageError("Choose --open-browser or --no-browser, not both.");
    const providerLifecycle = resolveProviderLifecycleCommand(args);
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
    const tenantStart = args[0] === "tenant" && args[1] === "start";
    const reconfiguration = (args[0] === "models" && (args[1] === "use" || args[1] === "add"))
        || (args[0] === "arms" && args[1] === "disable")
        || args[0] === "run"
        || (args[0] === "provider" && args[1] === "connect")
        || (args[0] === "verifier" && args[1] === "attach");
    if (!tenantStart && !reconfiguration && !providerLifecycle) {
        process.stderr.write("usage: millwork <docs|doctor|--version|models list|models use <catalog-model>|models add <catalog-model>|arms disable <arm-id>|run --preset <id> --objective <task>|provider list|provider connect <source-id>|provider rotate <connection-id>|provider disconnect <connection-id>|verifier attach --endpoint <url> --auth-ref <handle>|tenant show|tenant start> [options]\n");
        process.exit(2);
    }
    if (tenantStart) {
        const booleanFlags = new Set(["--write", "--plan", "--json", "--no-browser", "--open-browser"]);
        const valueFlags = new Set([
            "--template",
            "--model-deployment-id",
            "--source-id", "--served-variant-id",
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
    const applicationId = flagValue(args, "--application-id");
    const resumeAction = flagValue(args, "--resume-action");
    const idempotencyKey = flagValue(args, "--idempotency-key");
    const liveProofDigest = flagValue(args, "--live-proof-digest");
    const sourceId = flagValue(args, "--source-id");
    const servedVariantId = flagValue(args, "--served-variant-id");
    const byokFilter = { ...(sourceId ? { sourceId } : {}), ...(servedVariantId ? { servedVariantId } : {}) };
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
            await finishApplication(solver, saved);
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
    const applicationKey = idempotencyKey ?? (sourceId
        ? `${defaultApplicationKey}:${createHash("sha256").update(JSON.stringify(byokFilter)).digest("hex")}`
        : defaultApplicationKey);
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
            const application = await applyApprovedPlan(solver, {
                digest,
                issued_at: issuedAt,
                template_id: templateId,
                ...(modelDeploymentId ? { model_deployment_id: modelDeploymentId } : {}),
                ...(sourceId && servedVariantId ? { byok_offering: { source_id: sourceId, served_variant_id: servedVariantId, auth_scheme: "api_key" } } : {}),
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
            assertRecoveredByokChoice(recovered.application, byokFilter);
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
            if (templateId === "byok-open-model") {
                const plan = await planByokChoice(solver.tenantTemplates, { ...byokFilter, modelDeploymentId });
                emitJson({ state: "action_required", plan,
                    next_action: { type: "approve_plan", detail: "Choose one offered provider/model, then review --plan --json with --source-id and --served-variant-id. Apply its exact --digest and --issued-at only after approval. No connection or paid run was started." } });
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
