/**
 * Wraps GET/POST /v1/api-keys and POST /v1/api-keys/{id}/revoke -- key
 * management for an already-bootstrapped tenant (see ./tenants.js
 * for minting the tenant's first key). Not one of the SDK design's
 * listed namespaces; added for the "tenant bootstrap + API
 * key issuance" requirement.
 */
export class ApiKeysResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async create(opts) {
        return this.http.request({
            method: "POST",
            path: "api-keys",
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    async list() {
        const raw = await this.http.request({ method: "GET", path: "api-keys" });
        return raw.api_keys;
    }
    /** Relabels the key; answers the metadata wire (never the raw key). */
    async update(apiKeyId, input, opts) {
        return this.http.request({
            method: "PATCH",
            path: `api-keys/${encodeURIComponent(apiKeyId)}`,
            body: input,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
    async revoke(apiKeyId, opts) {
        return this.http.request({
            method: "POST",
            path: `api-keys/${encodeURIComponent(apiKeyId)}/revoke`,
            idempotencyKey: opts?.idempotencyKey,
        });
    }
}
//# sourceMappingURL=apiKeys.js.map