import { toPaginated } from "../pagination.js";
/**
 * Thin wrappers over the live content-free receipt projection.
 */
export class ReceiptsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async get(executionId) {
        return this.http.request({
            method: "GET",
            path: `receipts/${encodeURIComponent(executionId)}`,
        });
    }
    async list(filter = {}) {
        const response = await this.http.request({
            method: "GET",
            path: "receipts",
            query: {
                since: filter.since,
                status: filter.status,
                arm_id: filter.armId,
            },
        });
        return toPaginated(response.receipts, null, async () => this.list(filter));
    }
}
//# sourceMappingURL=receipts.js.map