import type { Tenant } from "../types.js";
/**
 * `POST /v1/tenants` is the only unauthenticated route under /v1 (a tenant
 * needs its first key from somewhere -- the API-key lifecycle), so this
 * is a standalone function rather than an instance method on an
 * already-authenticated `Solver` client. Not part of the SDK documentation's
 * per-object namespace list (which assumes a key already exists) -- added
 * because the tenant bootstrap contract requires tenant bootstrap to be usable end to
 * end without a separate HTTP call outside the SDK.
 */
export declare function bootstrapTenant(opts: {
    baseUrl: string;
    displayName: string;
    fetchImpl?: typeof fetch;
}): Promise<Tenant>;
