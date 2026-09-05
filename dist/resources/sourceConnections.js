/**
 * customer-owned source connections (`/v1/source-connections`). Creation consumes a
 * COMPLETED browser handoff intent (`sourceCredentialHandoffs`) -- no method
 * on this resource accepts credential material, and `auth_binding_ref` in
 * responses is an opaque broker handle, never a secret.
 */
export class SourceConnectionsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async create(input, options = {}) {
        return this.http.request({
            method: "POST",
            path: "source-connections",
            body: input,
            idempotencyKey: options.idempotencyKey,
        });
    }
    async list() {
        const response = await this.http.request({
            method: "GET",
            path: "source-connections",
        });
        return response.connections;
    }
    async get(connectionId) {
        return this.http.request({
            method: "GET",
            path: `source-connections/${encodeURIComponent(connectionId)}`,
        });
    }
    /** Runs the live credential test; the returned wire carries the observed
     * `test_state`/`test_error` rather than a separate probe envelope. */
    async test(connectionId, options = {}) {
        return this.http.request({
            method: "POST",
            path: `source-connections/${encodeURIComponent(connectionId)}/test`,
            idempotencyKey: options.idempotencyKey,
        });
    }
    /** Re-binds the connection to a NEW completed handoff intent. */
    async rotate(connectionId, input, options = {}) {
        return this.http.request({
            method: "POST",
            path: `source-connections/${encodeURIComponent(connectionId)}/rotate`,
            body: { handoff_intent_id: input.handoffIntentId },
            idempotencyKey: options.idempotencyKey,
        });
    }
    async revoke(connectionId, options = {}) {
        return this.http.request({
            method: "DELETE",
            path: `source-connections/${encodeURIComponent(connectionId)}`,
            idempotencyKey: options.idempotencyKey,
        });
    }
    /** Discovers the connection-authorized deployments and answers the synced set. */
    async syncDeployments(connectionId, options = {}) {
        const response = await this.http.request({
            method: "POST",
            path: `source-connections/${encodeURIComponent(connectionId)}/deployments/sync`,
            // The route validates an (empty) object body; sync takes no parameters.
            body: {},
            idempotencyKey: options.idempotencyKey,
        });
        return response.deployments;
    }
}
