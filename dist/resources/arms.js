import { toPaginated } from "../pagination.js";
/** Wraps GET/POST/PATCH/DELETE /v1/arms, per the SDK documentation's resource namespaces. */
export class ArmsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    /** POST answers the registration OUTCOME (arm_id/status/preflight),
     * not the full arm wire -- fetch via get() for the full object. */
    async create(input, opts) {
        return this.http.request({
            method: "POST",
            path: "arms",
            body: input,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    async list(filter) {
        const raw = await this.http.request({
            method: "GET",
            path: "arms",
            query: { kind: filter?.kind, status: filter?.status, cursor: filter?.cursor, limit: filter?.limit },
        });
        return toPaginated(raw.arms, raw.next_cursor, (cursor) => this.list({ ...filter, cursor }));
    }
    async get(armId) {
        return this.http.request({ method: "GET", path: `arms/${encodeURIComponent(armId)}` });
    }
    async update(armId, patch, opts) {
        return this.http.request({
            method: "PATCH",
            path: `arms/${encodeURIComponent(armId)}`,
            body: patch,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    async disable(armId, opts) {
        return this.http.request({
            method: "DELETE",
            path: `arms/${encodeURIComponent(armId)}`,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
}
