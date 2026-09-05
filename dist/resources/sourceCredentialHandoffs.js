/**
 * Browser credential handoffs (`/v1/source-credential-handoffs`). The SDK
 * NEVER carries a raw provider secret: `start` mints an intent whose
 * `continue_url` the human completes in a browser against the credential
 * broker, and `poll` observes the intent until it is `completed` -- the
 * resulting `handoff_intent_id` is what `sourceConnections.create` consumes.
 */
export class SourceCredentialHandoffsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async start(input, options = {}) {
        return this.http.request({
            method: "POST",
            path: "source-credential-handoffs",
            body: { source_id: input.sourceId, auth_scheme: input.authScheme },
            idempotencyKey: options.idempotencyKey,
        });
    }
    async poll(handoffIntentId) {
        return this.http.request({
            method: "GET",
            path: `source-credential-handoffs/${encodeURIComponent(handoffIntentId)}`,
        });
    }
}
