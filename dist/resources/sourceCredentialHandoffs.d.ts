import type { HttpClient } from "../httpClient.js";
import type { SourceAuthScheme, SourceCredentialHandoffIntent, StartedSourceCredentialHandoff } from "../types.js";
/**
 * Browser credential handoffs (`/v1/source-credential-handoffs`). The SDK
 * NEVER carries a raw provider secret: `start` mints an intent whose
 * `continue_url` the human completes in a browser against the credential
 * broker, and `poll` observes the intent until it is `completed` -- the
 * resulting `handoff_intent_id` is what `sourceConnections.create` consumes.
 */
export declare class SourceCredentialHandoffsResource {
    private readonly http;
    constructor(http: HttpClient);
    start(input: {
        sourceId: string;
        authScheme: SourceAuthScheme;
    }, options?: {
        idempotencyKey?: string;
    }): Promise<StartedSourceCredentialHandoff>;
    poll(handoffIntentId: string): Promise<SourceCredentialHandoffIntent>;
}
