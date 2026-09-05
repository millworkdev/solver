import { toPaginated } from "../pagination.js";
/** Wraps GET/POST /v1/verifiers, per the SDK documentation's resource namespaces. */
export class VerifiersResource {
    http;
    constructor(http) {
        this.http = http;
    }
    /** POST answers the registration OUTCOME (id/hash/status/preflight),
     * not the full verifier wire -- fetch via get() for the full object. */
    async create(input, opts) {
        return this.http.request({
            method: "POST",
            path: "verifiers",
            body: input,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    async list(filter) {
        const raw = await this.http.request({
            method: "GET",
            path: "verifiers",
            query: { cursor: filter?.cursor, limit: filter?.limit },
        });
        return toPaginated(raw.verifiers, raw.next_cursor, (cursor) => this.list({ ...filter, cursor }));
    }
    async get(verifierId) {
        return this.http.request({ method: "GET", path: `verifiers/${encodeURIComponent(verifierId)}` });
    }
    /** PATCH echoes the full updated verifier; `revision` bumps on update. */
    async update(verifierId, input, opts) {
        return this.http.request({
            method: "PATCH",
            path: `verifiers/${encodeURIComponent(verifierId)}`,
            body: input,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    /** Probes the endpoint and persists the observed health; `revision` is
     * deliberately untouched -- health is observation, not identity. */
    async test(verifierId, opts) {
        return this.http.request({
            method: "POST",
            path: `verifiers/${encodeURIComponent(verifierId)}/test`,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    /** Retires the verifier (204, idempotent). */
    async retire(verifierId, opts) {
        await this.http.request({
            method: "DELETE",
            path: `verifiers/${encodeURIComponent(verifierId)}`,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
}
