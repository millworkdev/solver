import { toPaginated } from "../pagination.js";
/**
 * Thin wrappers over the live proposal queue and decision routes.
 */
export class ProposalsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async list(filter = {}) {
        const response = await this.http.request({
            method: "GET",
            path: "proposals",
            query: {
                status: filter.status,
                arm_id: filter.armId,
                cursor: filter.cursor,
                limit: filter.limit,
            },
        });
        return toPaginated(response.proposals, response.next_cursor, (cursor) => this.list({ ...filter, cursor }));
    }
    async get(proposalId) {
        return this.http.request({
            method: "GET",
            path: `proposals/${encodeURIComponent(proposalId)}`,
        });
    }
    async approve(proposalId) {
        return this.http.request({
            method: "POST",
            path: `proposals/${encodeURIComponent(proposalId)}/approve`,
        });
    }
    async reject(proposalId, reason) {
        return this.http.request({
            method: "POST",
            path: `proposals/${encodeURIComponent(proposalId)}/reject`,
            body: reason === undefined ? {} : { reason },
        });
    }
}
//# sourceMappingURL=proposals.js.map