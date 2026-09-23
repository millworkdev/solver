import { SolverApiError, SolverApiNetworkError } from "./errors.js";
function checkedStopChoice(choice) {
    if (choice.kind === "no_expiration" && Object.keys(choice).length === 1)
        return { kind: choice.kind };
    if (choice.kind === "preset_days" && Object.keys(choice).length === 2 && [30, 90, 180, 365].includes(choice.days)) {
        return { kind: choice.kind, days: choice.days };
    }
    if (choice.kind === "calendar_date" && Object.keys(choice).length === 3
        && /^\d{4}-\d{2}-\d{2}$/.test(choice.date) && typeof choice.time_zone === "string" && choice.time_zone.length > 0) {
        return { kind: choice.kind, date: choice.date, time_zone: choice.time_zone };
    }
    throw new TypeError("Invalid verifier stop choice");
}
function refusal(error, connection) {
    if (error instanceof SolverApiError) {
        if (error.status === 401 || error.status === 403)
            throw error;
        if (error.status < 500 && error.status !== 408 && error.status !== 429) {
            return { state: "refused", next_action: "inspect", connection,
                error: { status: error.status, title: error.message } };
        }
        return null;
    }
    if (error instanceof SolverApiNetworkError) {
        if (error.status === 401 || error.status === 403)
            throw error;
        if (error.status !== undefined && error.status < 500 && error.status !== 408 && error.status !== 429) {
            return { state: "refused", next_action: "inspect", connection,
                error: { status: error.status, title: `HTTP ${error.status}: unreadable Problem response` } };
        }
        return null;
    }
    throw error;
}
/** Secretless protected verifier lifecycle. Enter the key only on the private page. */
export class VerifierConnection {
    http;
    constructor(http) {
        this.http = http;
    }
    async createIntent(verifierId, stopChoice, opts) {
        return this.http.request({
            method: "POST", path: `verifiers/${encodeURIComponent(verifierId)}/connection-intents`,
            body: { stop_choice: checkedStopChoice(stopChoice) }, idempotencyKey: opts?.idempotencyKey,
        });
    }
    async inspect(verifierId, opts) {
        return this.http.request({
            method: "GET", path: `verifiers/${encodeURIComponent(verifierId)}/connection`,
            query: opts?.operationKey ? { operation_key: opts.operationKey } : undefined,
        });
    }
    /** A resume keeps operationKey, but uses a fresh request idempotencyKey. */
    async testAndPromote(verifierId, input, opts) {
        if (typeof input.handle !== "string" || !Number.isInteger(input.captured_generation)) {
            throw new TypeError("A staged handle and captured generation are required");
        }
        return this.http.request({
            method: "POST", path: `verifiers/${encodeURIComponent(verifierId)}/connection/test`,
            body: opts?.operationKey
                ? { handle: input.handle, captured_generation: input.captured_generation, operation_key: opts.operationKey }
                : { handle: input.handle, captured_generation: input.captured_generation },
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    async revoke(verifierId, opts) {
        return this.http.request({
            method: "POST", path: `verifiers/${encodeURIComponent(verifierId)}/connection/revoke`,
            body: opts?.operationKey ? { operation_key: opts.operationKey } : undefined,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    /** Continue only the key staged for this intent, then read back the actual state. */
    async continue(verifierId, operationKey, requestKey) {
        const initial = await this.safeInspect(verifierId, operationKey);
        if (initial.refused)
            return initial.refused;
        const before = initial.view;
        if (!before)
            return { state: "unknown", next_action: "resume", connection: null };
        const recorded = before.last_operation;
        if (recorded?.status !== "unknown" && recorded?.kind === "promote" && recorded.phase === "committed") {
            return { state: "done", next_action: null, connection: before };
        }
        const stagedHandle = recorded?.status !== "unknown" && recorded?.kind === "stage" && typeof recorded.resulting_state?.handle === "string"
            ? recorded.resulting_state.handle : null;
        if (!stagedHandle)
            return { state: "action_required", next_action: "enter_key", connection: before };
        const pending = before.pending_key;
        if (pending && pending.handle !== stagedHandle)
            return { state: "changed", next_action: "inspect", connection: before };
        if (!pending)
            return this.classifyPromotion(before, stagedHandle);
        let writeRefusal = null;
        try {
            await this.testAndPromote(verifierId, { handle: pending.handle, captured_generation: pending.captured_generation }, { operationKey, idempotencyKey: requestKey });
        }
        catch (error) {
            writeRefusal = refusal(error, before);
        }
        const readBack = await this.safeInspect(verifierId, operationKey);
        if (readBack.refused)
            return readBack.refused;
        const after = readBack.view;
        if (!after)
            return writeRefusal ?? { state: "unknown", next_action: "resume", connection: null };
        if (writeRefusal) {
            const classified = this.classifyPromotion(after, stagedHandle);
            return classified.state === "test_failed" || classified.state === "done" ? classified : { ...writeRefusal, connection: after };
        }
        return this.classifyPromotion(after, stagedHandle);
    }
    /** Explicit confirmation is required because disconnect is a write. */
    async disconnect(verifierId, operationKey, requestKey, confirmed) {
        if (!confirmed)
            throw new Error("Verifier disconnect requires explicit confirmation");
        let writeRefusal = null;
        try {
            await this.revoke(verifierId, { operationKey, idempotencyKey: requestKey });
        }
        catch (error) {
            writeRefusal = refusal(error, null);
        }
        const readBack = await this.safeInspect(verifierId, operationKey);
        if (readBack.refused)
            return readBack.refused;
        const view = readBack.view;
        if (!view)
            return writeRefusal ?? { state: "unknown", next_action: "resume", connection: null };
        if (view.status === "revoked" || (view.last_operation?.status !== "unknown" && view.last_operation?.kind === "revoke" && view.last_operation.phase === "committed")) {
            return { state: "done", next_action: null, connection: view };
        }
        if (writeRefusal)
            return { ...writeRefusal, connection: view };
        return { state: "unknown", next_action: "resume", connection: view };
    }
    async safeInspect(verifierId, operationKey) {
        try {
            return { view: await this.inspect(verifierId, { operationKey }) };
        }
        catch (error) {
            const refused = refusal(error, null);
            return refused ? { view: null, refused } : { view: null };
        }
    }
    classifyPromotion(view, stagedHandle) {
        if (view.status === "active" && view.handle === stagedHandle)
            return { state: "done", next_action: null, connection: view };
        if (view.last_test?.outcome === "failed" && view.last_test.handle === stagedHandle) {
            return { state: "test_failed", next_action: "start_again", connection: view };
        }
        if (view.pending_key?.handle === stagedHandle)
            return { state: "pending", next_action: "resume", connection: view };
        return { state: "changed", next_action: "inspect", connection: view };
    }
}
