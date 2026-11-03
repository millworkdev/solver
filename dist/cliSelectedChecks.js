import { readFile } from "node:fs/promises";
import { InspectionUsageError } from "./cliInspection.js";
import { SolverApiError, SolverApiNetworkError } from "./errors.js";
const SCHEMA = "millwork.selected-model-checks.v1";
const USAGE = "usage: millwork models inventory checks <plan|start|status|operation-status|resume|cancel> [options]";
function opaque(value, label) {
    if (typeof value !== "string" || !value.trim() || value.length > 200) {
        throw new InspectionUsageError(`${label} must be a non-empty string of at most 200 characters.`);
    }
    return value;
}
/** Resolve all arguments before credentials, files or network access. --yes is not paid approval. */
export function resolveSelectedChecksCommand(args) {
    if (args[0] !== "models" || args[1] !== "inventory" || args[2] !== "checks")
        return null;
    const action = args[3];
    if (!["plan", "start", "status", "operation-status", "resume", "cancel"].includes(action ?? "")) {
        throw new InspectionUsageError(USAGE);
    }
    const write = action === "start" || action === "resume" || action === "cancel";
    const file = action === "plan" || write;
    const values = new Map();
    const seen = new Set();
    const positionals = [];
    for (let index = 4; index < args.length; index++) {
        const argument = args[index];
        if (!argument.startsWith("-")) {
            positionals.push(argument);
            continue;
        }
        if (seen.has(argument))
            throw new InspectionUsageError(`Duplicate selected-check argument: ${argument}`);
        seen.add(argument);
        if (argument === "--json" || (argument === "--yes" && write))
            continue;
        if (!((argument === "--input" && file) || (argument === "--idempotency-key" && write))) {
            throw new InspectionUsageError(`Unsupported selected-check argument: ${argument}`);
        }
        const value = args[++index];
        if (!value?.trim() || value.startsWith("-"))
            throw new InspectionUsageError(`${argument} requires a value.`);
        values.set(argument, value);
    }
    if (write && (!seen.has("--yes") || !values.has("--idempotency-key"))) {
        throw new InspectionUsageError("Selected-check writes require --yes and the original caller-owned --idempotency-key. Neither grants paid batch approval.");
    }
    if (file && !values.has("--input"))
        throw new InspectionUsageError("Use --input <original JSON file>; retain that file unchanged for recovery.");
    const needsId = action !== "plan" && action !== "start";
    if (positionals.length !== (needsId ? 1 : 0))
        throw new InspectionUsageError(USAGE);
    const id = needsId ? opaque(positionals[0], "Batch ID or original operation key") : undefined;
    if (action === "status" || action === "operation-status")
        return { action, id: id };
    if (action === "plan")
        return { action, inputPath: values.get("--input") };
    const idempotencyKey = opaque(values.get("--idempotency-key"), "Original operation key");
    if (idempotencyKey !== idempotencyKey.trim() || !/^[\x20-\x7e]+$/.test(idempotencyKey))
        throw new InspectionUsageError("The original operation key must be visible ASCII with no surrounding whitespace for the HTTP header.");
    if (action === "start")
        return { action, inputPath: values.get("--input"), idempotencyKey };
    return { action: action, id: id, inputPath: values.get("--input"), idempotencyKey };
}
export function selectedChecksReadOnly(command) {
    return command.action === "plan" || command.action === "status" || command.action === "operation-status";
}
/** The existing host authority covers one run, never an entire batch or a resumed approval. */
export function selectedChecksPaidRefusal(command) {
    if (command.action !== "start" && command.action !== "resume")
        return null;
    return { schema_version: SCHEMA, operation: command.action, read_only: false,
        state: "action_required", refusal_code: "host_batch_approval_required",
        detail: "The host's one-run approval channel cannot authorize a batch. No paid batch request was sent.",
        next_action: { type: "review_selected_checks_in_dashboard_or_api",
            detail: "Review the exact selected-model batch, eligible count, provider maxima and separate ordinary fees in the dashboard or an explicitly controlled API client. A prompt, --yes or single-run approval cannot authorize a batch." } };
}
function object(value, label, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new InspectionUsageError(`${label} must be a JSON object.`);
    const result = value;
    if (Object.keys(result).some(key => !keys.includes(key)))
        throw new InspectionUsageError(`${label} contains an unsupported field.`);
    return result;
}
function revision(value, label) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new InspectionUsageError(`${label} must be a positive safe integer.`);
}
async function inputDocument(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        throw new InspectionUsageError("The original selected-check input file could not be read as JSON.");
    }
}
/** Validate shape only. Eligibility, signed authority and money remain server-owned. Never expand selection. */
function planInput(value) {
    const input = object(value, "Selected-check request", ["batch_id", "expected_revision", "connection_id", "binding_revision", "snapshot_digest", "filter", "selected", "task"]);
    opaque(input.connection_id, "Connection ID");
    revision(input.binding_revision, "Binding revision");
    if (typeof input.snapshot_digest !== "string" || !/^[a-f0-9]{64}$/.test(input.snapshot_digest))
        throw new InspectionUsageError("Use the exact inventory snapshot digest.");
    if ((input.batch_id === undefined) !== (input.expected_revision === undefined))
        throw new InspectionUsageError("A replacement plan needs both the original batch ID and current revision.");
    if (input.batch_id !== undefined) {
        opaque(input.batch_id, "Batch ID");
        revision(input.expected_revision, "Expected revision");
    }
    object(input.filter, "Original inventory filter", ["access_lane", "connection_id", "source_id", "q", "readiness", "publisher_id", "model_group_key", "limit", "view", "include_tested"]);
    const task = object(input.task, "Selected-check task", ["objective"]);
    if (typeof task.objective !== "string" || !task.objective.trim() || task.objective.length > 4000)
        throw new InspectionUsageError("A task objective of 1 through 4000 characters is required.");
    if (!Array.isArray(input.selected) || input.selected.length < 1 || input.selected.length > 20)
        throw new InspectionUsageError("Select 1 through 20 exact inventory routes.");
    for (const value of input.selected) {
        const selection = object(value, "Exact selected route", ["item_id", "route_id", "observation_revision", "snapshot_id", "authority_id", "arm_id"]);
        for (const key of ["item_id", "route_id", "observation_revision", "snapshot_id"])
            opaque(selection[key], key);
        for (const key of ["authority_id", "arm_id"])
            if (selection[key] !== null)
                opaque(selection[key], key);
    }
    return input;
}
function cancelInput(value) {
    const input = object(value, "Original cancellation", ["expected_revision"]);
    revision(input.expected_revision, "Expected revision");
    return input;
}
function envelope(command) {
    return { schema_version: SCHEMA, operation: command.action, read_only: selectedChecksReadOnly(command),
        ...(command.action === "operation-status" ? { original_operation_key: command.id } : {}) };
}
function problem(error) {
    if (error instanceof SolverApiError)
        return { error: "solver_api_error", problem: error.problem };
    if (error instanceof SolverApiNetworkError)
        return { error: "solver_api_network_error", ...(error.status === undefined ? {} : { http_status: error.status }) };
    return null;
}
/** A successful HTTP status can still lose its body after the operation committed. */
async function operationResponse(request) {
    try {
        return await request();
    }
    catch (error) {
        if (error instanceof SolverApiError || error instanceof SolverApiNetworkError)
            throw error;
        throw new SolverApiNetworkError("The operation response could not be read. Retain the original operation and input.", error);
    }
}
/** Preserve original identity on transport/API failure; no retry, new key, fresh revision or inferred refund. */
export function selectedChecksFailure(command, error) {
    const failure = problem(error);
    if (!failure)
        return null;
    return { ...envelope(command), ...failure, ...(command.action === "cancel" ? {
            state: error instanceof SolverApiNetworkError || (error instanceof SolverApiError && error.status >= 500) ? "outcome_unknown" : "request_refused",
            recovery: { original_operation_key: command.idempotencyKey, original_input_path: command.inputPath, batch_id: command.id,
                detail: "Retain the original file and key. Read operation-status with that key, then current status. An unavailable operation read does not prove absence. Never automatically change the key, revision or payload. Cancellation does not prove an upstream abort or refund." },
        } : {}) };
}
/** Thin SDK bindings. Paid boundaries run before opening even the input file. */
export async function runSelectedChecksCommand(command, solver) {
    const refusal = selectedChecksPaidRefusal(command);
    if (refusal)
        return refusal;
    switch (command.action) {
        case "plan": return { ...envelope(command), data: await solver.modelInventory.planChecks(planInput(await inputDocument(command.inputPath))) };
        case "status": return { ...envelope(command), data: await solver.modelInventory.checks(command.id) };
        case "cancel": {
            const input = cancelInput(await inputDocument(command.inputPath));
            return { ...envelope(command), data: await operationResponse(() => solver.modelInventory.cancelChecks(command.id, input, { idempotencyKey: command.idempotencyKey })) };
        }
        case "operation-status": {
            const historical = await operationResponse(() => solver.modelInventory.checkOperation(command.id));
            // The recovered response is historical. Its costs/revision are never presented as current.
            const batchId = opaque(historical.batch_id, "Recovered batch ID");
            let current;
            try {
                current = await operationResponse(() => solver.modelInventory.checks(batchId));
            }
            catch (error) {
                const failure = problem(error);
                if (!failure)
                    throw error;
                return { ...envelope(command), error: "current_progress_unavailable", historical_response: historical,
                    current_progress: null, current_progress_available: false, current_read_error: failure };
            }
            if (!current || current.batch_id !== batchId)
                return { ...envelope(command), error: "current_progress_identity_mismatch",
                    historical_response: historical, current_progress: null, current_progress_available: false };
            return { ...envelope(command), historical_response: historical, current_progress: current, current_progress_available: true };
        }
        default: throw new InspectionUsageError("Paid selected checks require a batch-capable host approval.");
    }
}
