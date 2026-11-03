import { readFile } from "node:fs/promises";
import { InspectionUsageError } from "./cliInspection.js";
const filterFlags = new Map([
    ["--access-lane", "access_lane"], ["--connection-id", "connection_id"], ["--source-id", "source_id"], ["--q", "q"],
    ["--readiness", "readiness"], ["--publisher-id", "publisher_id"], ["--model-group-key", "model_group_key"],
    ["--cursor", "cursor"], ["--limit", "limit"], ["--view", "view"], ["--snapshot-digest", "snapshot_digest"],
]);
/** Resolve the entire grammar before key lookup, file loading or network access. */
export function resolveInventoryCommand(args) {
    if (args[0] !== "models" || args[1] !== "inventory")
        return null;
    const action = args[2];
    const reads = ["show", "authority", "import-status", "authorization-status"];
    const fileActions = ["plan", "quote", "authorize", "add"];
    const filters = action === "list" || action === "facets";
    const mutation = action === "refresh" || action === "authorize" || action === "add";
    if (!action || (!filters && !reads.includes(action) && !fileActions.includes(action) && action !== "refresh")) {
        throw new InspectionUsageError("usage: millwork models inventory <list|facets|show|refresh|import-status|plan|authorize|authority|authorization-status|quote|add> [options]");
    }
    const values = new Map();
    const positionals = [];
    const seen = new Set();
    for (let index = 3; index < args.length; index++) {
        const argument = args[index];
        if (!argument.startsWith("-")) {
            positionals.push(argument);
            continue;
        }
        if (seen.has(argument))
            throw new InspectionUsageError(`Duplicate inventory argument: ${argument}`);
        seen.add(argument);
        if (argument === "--json")
            continue;
        if (argument === "--yes" && mutation)
            continue;
        if (filters && ["--include-tested", "--exclude-tested"].includes(argument))
            continue;
        const allowed = (filters && filterFlags.has(argument))
            || (fileActions.includes(action) && argument === "--input")
            || (mutation && argument === "--idempotency-key");
        if (!allowed)
            throw new InspectionUsageError(`Unsupported inventory argument: ${argument}`);
        const value = args[++index];
        if (!value || value.startsWith("--") || !value.trim())
            throw new InspectionUsageError(`${argument} requires a value`);
        values.set(argument, value);
    }
    if (mutation && (!seen.has("--yes") || !values.has("--idempotency-key"))) {
        throw new InspectionUsageError("Inventory writes require --yes and a caller-owned --idempotency-key. Retain the original input and key for recovery; this grants no paid-run approval.");
    }
    if (filters) {
        if (positionals.length || (seen.has("--include-tested") && seen.has("--exclude-tested"))) {
            throw new InspectionUsageError("Inventory list/facets accept filters only; choose one tested-route inclusion flag.");
        }
        const filter = {};
        for (const [flag, field] of filterFlags) {
            const value = values.get(flag);
            if (value === undefined)
                continue;
            if (field === "limit") {
                if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 200) {
                    throw new InspectionUsageError("Inventory --limit must be an integer from 1 through 200.");
                }
                filter[field] = Number(value);
            }
            else
                filter[field] = value;
        }
        if (filter.access_lane && !["byok", "millwork_pool"].includes(String(filter.access_lane))) {
            throw new InspectionUsageError("Inventory --access-lane must be byok or millwork_pool.");
        }
        if (filter.readiness && !["ready", "needs_action", "not_available"].includes(String(filter.readiness))) {
            throw new InspectionUsageError("Unknown inventory readiness filter.");
        }
        if (filter.view && !["routes", "models"].includes(String(filter.view))) {
            throw new InspectionUsageError("Inventory --view must be routes or models.");
        }
        if (seen.has("--include-tested"))
            filter.include_tested = true;
        if (seen.has("--exclude-tested"))
            filter.include_tested = false;
        return { action: action, filter: filter };
    }
    if (reads.includes(action) || action === "refresh") {
        if (positionals.length !== 1)
            throw new InspectionUsageError(`Inventory ${action} requires exactly one opaque ID.`);
        return action === "refresh" ? { action, connectionId: positionals[0], idempotencyKey: values.get("--idempotency-key") }
            : { action: action, id: positionals[0] };
    }
    if (positionals.length || !values.has("--input"))
        throw new InspectionUsageError(`Inventory ${action} requires --input <original JSON file>.`);
    return action === "authorize" || action === "add"
        ? { action, inputPath: values.get("--input"), idempotencyKey: values.get("--idempotency-key") }
        : { action: action, inputPath: values.get("--input") };
}
function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new InspectionUsageError(`${label} must be a JSON object.`);
    return value;
}
function text(value, label) {
    if (typeof value !== "string" || !value.trim())
        throw new InspectionUsageError(`${label} must be a non-empty string.`);
    return value;
}
async function inputDocument(path) {
    try {
        return object(JSON.parse(await readFile(path, "utf8")), "Inventory input");
    }
    catch (error) {
        if (error instanceof InspectionUsageError)
            throw error;
        throw new InspectionUsageError("The inventory input file could not be read as a JSON object.");
    }
}
function planInput(value) {
    const input = object(value, "Original plan inputs");
    for (const name of ["item_id", "route_id", "observation_revision"])
        text(input[name], name);
    if (input.purpose !== "add" && input.purpose !== "execute")
        throw new InspectionUsageError("Plan purpose must be add or execute.");
    return input;
}
function confirmationInput(document) {
    const input = object(document.confirmation ?? document, "Reviewed plan confirmation");
    text(input.plan_token, "Signed plan token");
    text(input.plan_digest, "Plan digest");
    planInput(input.original_inputs);
    return input;
}
function authorityInput(document) {
    const authority = object(document.data ?? document, "Returned authority");
    const template = object(authority.arm_registration_template, "Server-issued registration template");
    const authorityId = text(authority.authority_id, "Authority ID");
    const deploymentId = text(authority.model_deployment_id, "Deployment ID");
    if (template.route_authority_id !== authorityId || (template.model_deployment_id !== undefined && template.model_deployment_id !== deploymentId) || template.kind !== "model") {
        throw new InspectionUsageError("The returned authority and registration template do not identify the same exact route. Recover the original authorization.");
    }
    return authority;
}
export function inventoryCommandReadOnly(command) {
    return !["refresh", "authorize", "add"].includes(command.action);
}
/** Thin operations only: no paid task, automatic replan, inferred template or replacement key. */
export async function runInventoryCommand(command, solver) {
    let data;
    let confirmation;
    switch (command.action) {
        case "list":
            data = await solver.modelInventory.list(command.filter);
            break;
        case "facets":
            data = await solver.modelInventory.facets(command.filter);
            break;
        case "show":
            data = await solver.modelInventory.get(command.id);
            break;
        case "authority":
            data = await solver.modelInventory.authority(command.id);
            break;
        case "import-status":
            data = await solver.modelInventory.importStatus(command.id);
            break;
        case "authorization-status":
            data = await solver.modelInventory.authorizationOperation(command.id);
            break;
        case "refresh":
            data = await solver.modelInventory.importConnection(command.connectionId, { idempotencyKey: command.idempotencyKey });
            break;
        case "plan": {
            const original = planInput(await inputDocument(command.inputPath));
            const plan = await solver.modelInventory.plan(original);
            data = plan;
            confirmation = plan.plan_token && plan.plan_digest ? { plan_token: plan.plan_token,
                plan_digest: plan.plan_digest, original_inputs: original } : null;
            break;
        }
        case "authorize":
            data = await solver.modelInventory.authorize(confirmationInput(await inputDocument(command.inputPath)), { idempotencyKey: command.idempotencyKey });
            break;
        case "quote": {
            const document = await inputDocument(command.inputPath);
            const input = confirmationInput(document);
            text(document.authority_id, "Authority ID");
            if (typeof document.provider_usage_budget_usd !== "number" || !Number.isFinite(document.provider_usage_budget_usd)
                || document.provider_usage_budget_usd < 0)
                throw new InspectionUsageError("Quote input needs a nonnegative provider_usage_budget_usd.");
            data = await solver.modelInventory.quote({ ...input, authority_id: document.authority_id,
                provider_usage_budget_usd: document.provider_usage_budget_usd });
            break;
        }
        case "add": {
            const authority = authorityInput(await inputDocument(command.inputPath));
            data = await solver.arms.create(authority.arm_registration_template, { idempotencyKey: command.idempotencyKey });
            break;
        }
    }
    return { schema_version: "millwork.model-inventory.v1", operation: command.action,
        read_only: inventoryCommandReadOnly(command), data, ...(confirmation !== undefined ? { confirmation } : {}) };
}
/** Load the original reviewed execute consent; never mint or refresh it here. */
export async function readInventoryRunApproval(path) {
    const document = await inputDocument(path);
    const input = object(document.byok_inventory ?? document, "Inventory run approval");
    confirmationInput(input);
    text(input.authority_id, "Authority ID");
    if (typeof input.provider_usage_budget_usd !== "number" || !Number.isFinite(input.provider_usage_budget_usd)
        || input.provider_usage_budget_usd < 0 || typeof input.price_approval_sha256 !== "string"
        || !/^[a-f0-9]{64}$/.test(input.price_approval_sha256)) {
        throw new InspectionUsageError("Inventory run approval needs the original nonnegative provider budget and exact quote hash.");
    }
    return input;
}
