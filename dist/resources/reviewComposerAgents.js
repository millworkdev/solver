/** Dedicated private-agent registration bound to a verified GitHub connection. */
export class ReviewComposerAgentsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async create(input, opts) {
        return this.http.request({
            method: "POST",
            path: "review-composer/agents",
            body: input,
            idempotencyKey: opts.idempotencyKey,
        });
    }
    async createConnectionIntent(armId, stopChoice) {
        return this.http.request({ method: "POST",
            path: `review-composer/agents/${encodeURIComponent(armId)}/connection/intents`,
            body: { stop_choice: stopChoice } });
    }
    async connection(armId) {
        return this.http.request({ method: "GET",
            path: `review-composer/agents/${encodeURIComponent(armId)}/connection` });
    }
    async testConnection(armId, pending) {
        return this.http.request({ method: "POST",
            path: `review-composer/agents/${encodeURIComponent(armId)}/connection/test`, body: pending });
    }
    async revokeConnection(armId, operationKey) {
        return this.http.request({ method: "POST",
            path: `review-composer/agents/${encodeURIComponent(armId)}/connection/revoke`,
            body: { operation_key: operationKey } });
    }
}
