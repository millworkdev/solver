import { SolverApiError, SolverApiNetworkError } from "../errors.js";
/**
 * `POST /v1/tenants` is the only unauthenticated route under /v1 (a tenant
 * needs its first key from somewhere -- the API-key lifecycle), so this
 * is a standalone function rather than an instance method on an
 * already-authenticated `Solver` client. Not part of the SDK documentation's
 * per-object namespace list (which assumes a key already exists) -- added
 * because the tenant bootstrap contract requires tenant bootstrap to be usable end to
 * end without a separate HTTP call outside the SDK.
 */
export async function bootstrapTenant(opts) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const url = new URL("tenants", opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`);
    let response;
    try {
        response = await fetchImpl(url, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ display_name: opts.displayName }),
        });
    }
    catch (cause) {
        throw new SolverApiNetworkError("Tenant bootstrap request failed: network error.", cause);
    }
    if (response.ok)
        return (await response.json());
    let body;
    try {
        body = (await response.json());
    }
    catch (cause) {
        throw new SolverApiNetworkError(`Tenant bootstrap received ${response.status} with a body that could not be parsed as a Problem response.`, cause);
    }
    throw new SolverApiError(body);
}
