function inventoryQuery(filter) {
    return {
        access_lane: filter.access_lane,
        connection_id: filter.connection_id,
        source_id: filter.source_id,
        q: filter.q,
        readiness: filter.readiness,
        publisher_id: filter.publisher_id,
        model_group_key: filter.model_group_key,
        cursor: filter.cursor,
        limit: filter.limit,
        view: filter.view,
        include_tested: filter.include_tested === undefined ? undefined : String(filter.include_tested),
        snapshot_digest: filter.snapshot_digest,
    };
}
function requireOperationKey(key) {
    if (!key.trim()) {
        throw new TypeError("Inventory mutations require a non-empty caller-owned idempotency key.");
    }
}
/**
 * Account inventory is separate from the tested catalog. Planning is a fresh
 * read-only computation; authorization records permission for the reviewed
 * route envelope. Neither operation adds an arm or approves a paid task.
 */
export class ModelInventoryResource {
    http;
    constructor(http) {
        this.http = http;
    }
    /** Return the full server snapshot/count metadata; do not derive totals from this page. */
    async list(filter = {}) {
        return this.http.request({
            method: "GET", path: "model-inventory", query: inventoryQuery(filter),
        });
    }
    async facets(filter = {}) {
        return this.http.request({
            method: "GET", path: "model-inventory/facets", query: inventoryQuery(filter),
        });
    }
    async get(itemId) {
        return this.http.request({
            method: "GET",
            path: `model-inventory/${encodeURIComponent(itemId)}`,
        });
    }
    /** Refresh metadata only; this starts no inference, authorization or arm registration. */
    async importConnection(connectionId, options) {
        requireOperationKey(options.idempotencyKey);
        return this.http.request({
            method: "POST", path: "model-inventory/imports", body: { connection_id: connectionId },
            idempotencyKey: options.idempotencyKey,
        });
    }
    async importStatus(importId) {
        return this.http.request({
            method: "GET", path: `model-inventory/imports/${encodeURIComponent(importId)}`,
        });
    }
    async plan(input) {
        return this.http.request({
            method: "POST",
            path: "model-inventory/plan",
            body: input,
        });
    }
    /** Retry an uncertain issuance with the same original inputs and caller key. */
    async authorize(input, options) {
        requireOperationKey(options.idempotencyKey);
        return this.http.request({
            method: "POST",
            path: "model-route-authorities",
            body: input,
            idempotencyKey: options.idempotencyKey,
        });
    }
    async authority(authorityId) {
        return this.http.request({
            method: "GET", path: `model-route-authorities/${encodeURIComponent(authorityId)}`,
        });
    }
    /** Reconcile the original principal's operation after an uncertain issuance, even after its deadline. */
    async authorizationOperation(operationKey) {
        return this.http.request({
            method: "GET", path: `model-route-authorities/operations/${encodeURIComponent(operationKey)}`,
        });
    }
    /** An execute-plan quote does not grant host approval or submit an execution. */
    async quote(input) {
        return this.http.request({
            method: "POST", path: "model-inventory/quote", body: input,
        });
    }
    /** Metadata/price planning only. Exact selected IDs and original snapshot remain caller-owned. */
    async planChecks(input) {
        return this.http.request({ method: "POST", path: "model-check-batches/plan", body: input });
    }
    /** Explicitly approve the exact returned plan; retain its payload/key across uncertain responses. */
    async startChecks(plan, options) {
        requireOperationKey(options.idempotencyKey);
        return this.http.request({ method: "POST", path: "model-check-batches", body: { plan }, idempotencyKey: options.idempotencyKey });
    }
    async checks(batchId) {
        return this.http.request({ method: "GET", path: `model-check-batches/${encodeURIComponent(batchId)}` });
    }
    async checkOperation(operationKey) {
        return this.http.request({ method: "GET", path: `model-check-batches/operations/${encodeURIComponent(operationKey)}` });
    }
    /** Explicit CAS: only untouched work; preserve exact acknowledged unknown IDs and fresh plan if reviewed. */
    async resumeChecks(batchId, input, options) {
        requireOperationKey(options.idempotencyKey);
        return this.http.request({ method: "POST", path: `model-check-batches/${encodeURIComponent(batchId)}/resume`, body: input, idempotencyKey: options.idempotencyKey });
    }
    async cancelChecks(batchId, input, options) {
        requireOperationKey(options.idempotencyKey);
        return this.http.request({ method: "POST", path: `model-check-batches/${encodeURIComponent(batchId)}/cancel`, body: input, idempotencyKey: options.idempotencyKey });
    }
}
