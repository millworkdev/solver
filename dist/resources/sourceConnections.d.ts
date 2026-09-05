import type { HttpClient } from "../httpClient.js";
import type { CreateSourceConnectionInput, ModelDeployment, RevokedSourceConnectionAck, SourceConnection } from "../types.js";
/**
 * customer-owned source connections (`/v1/source-connections`). Creation consumes a
 * COMPLETED browser handoff intent (`sourceCredentialHandoffs`) -- no method
 * on this resource accepts credential material, and `auth_binding_ref` in
 * responses is an opaque broker handle, never a secret.
 */
export declare class SourceConnectionsResource {
    private readonly http;
    constructor(http: HttpClient);
    create(input: CreateSourceConnectionInput, options?: {
        idempotencyKey?: string;
    }): Promise<SourceConnection>;
    list(): Promise<SourceConnection[]>;
    get(connectionId: string): Promise<SourceConnection>;
    /** Runs the live credential test; the returned wire carries the observed
     * `test_state`/`test_error` rather than a separate probe envelope. */
    test(connectionId: string, options?: {
        idempotencyKey?: string;
    }): Promise<SourceConnection>;
    /** Re-binds the connection to a NEW completed handoff intent. */
    rotate(connectionId: string, input: {
        handoffIntentId: string;
    }, options?: {
        idempotencyKey?: string;
    }): Promise<SourceConnection>;
    revoke(connectionId: string, options?: {
        idempotencyKey?: string;
    }): Promise<RevokedSourceConnectionAck>;
    /** Discovers the connection-authorized deployments and answers the synced set. */
    syncDeployments(connectionId: string, options?: {
        idempotencyKey?: string;
    }): Promise<ModelDeployment[]>;
}
