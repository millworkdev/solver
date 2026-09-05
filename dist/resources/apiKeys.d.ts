import type { HttpClient } from "../httpClient.js";
import type { ApiKey } from "../types.js";
/**
 * Wraps GET/POST /v1/api-keys and POST /v1/api-keys/{id}/revoke -- key
 * management for an already-bootstrapped tenant (see the tenant resource
 * for minting the tenant's first key). Not one of the SDK documentation's
 * listed namespaces; added for the tenant bootstrap contract's "tenant bootstrap + API
 * key issuance" requirement.
 */
export declare class ApiKeysResource {
    private readonly http;
    constructor(http: HttpClient);
    create(opts?: {
        idempotencyKey?: string;
    }): Promise<ApiKey>;
    list(): Promise<ApiKey[]>;
    /** Relabels the key; answers the metadata wire (never the raw key). */
    update(apiKeyId: string, input: {
        display_name: string;
    }, opts?: {
        idempotencyKey?: string;
    }): Promise<ApiKey>;
    revoke(apiKeyId: string, opts?: {
        idempotencyKey?: string;
    }): Promise<ApiKey>;
}
