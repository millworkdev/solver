import { SolverApiError, SolverApiNetworkError } from "./errors.js";
function buildUrl(baseUrl, path, query) {
    const url = new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined)
                url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}
function isRetryableStatus(status) {
    return status >= 500;
}
/**
 * The safe-transport security invariant. An automatic retry is only safe when
 * replaying the request cannot apply the work twice:
 *
 *   * a safe read applies nothing, so it may always retry;
 *   * a mutation carrying a CALLER-OWNED idempotency key may retry, because the
 *     server collapses the replay onto the first commit;
 *   * every other mutation gets exactly one attempt. A lost response after an
 *     unkeyed POST is indistinguishable from a lost request, and retrying it is
 *     how a client silently double-charges, double-submits, or double-registers.
 *
 * The key must come from the CALLER. Generating one here would make every
 * mutation look retryable while giving the caller no way to replay the same
 * operation across process restarts -- the SDK would be claiming a guarantee it
 * cannot keep. A whitespace-only key is treated as absent for the same reason.
 */
export function requestRetryBoundary(request) {
    if (request.method === "GET" || request.method === "HEAD")
        return "safe_read";
    if (request.idempotencyKey !== undefined && request.idempotencyKey.trim().length > 0) {
        return "same_key_mutation";
    }
    return "single_attempt_mutation";
}
/**
 * Thin fetch-based HTTP client: auth header, JSON encode/decode, typed
 * SolverApiError on any non-2xx, and automatic retry of network errors and 5xx
 * ONLY inside the safe-transport boundary (never a 4xx, never an unkeyed
 * mutation -- see requestRetryBoundary). Per the SDK design's "thin client,
 * no hidden logic" rule -- no ranking/policy/caching behavior lives here.
 */
export class HttpClient {
    apiKey;
    baseUrl;
    maxRetries;
    retryBackoffMs;
    fetchImpl;
    constructor(opts) {
        this.apiKey = opts.apiKey;
        this.baseUrl = opts.baseUrl;
        this.maxRetries = opts.maxRetries ?? 2;
        this.retryBackoffMs = opts.retryBackoffMs ?? 500;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }
    async request(opts) {
        const url = buildUrl(this.baseUrl, opts.path, opts.query);
        const headers = {
            authorization: `Bearer ${this.apiKey}`,
            accept: "application/json",
        };
        if (opts.body !== undefined)
            headers["content-type"] = "application/json";
        if (opts.idempotencyKey !== undefined)
            headers["idempotency-key"] = opts.idempotencyKey;
        // Decided once, before the first attempt, from the request as the caller
        // wrote it. The headers and serialized body below are likewise built once
        // and reused, so a retry is a byte-identical replay -- a retry that changed
        // the key or the body would be a different operation wearing the same
        // guarantee.
        const mayRetry = requestRetryBoundary(opts) !== "single_attempt_mutation";
        const serializedBody = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
        let attempt = 0;
        for (;;) {
            let response;
            try {
                response = await this.fetchImpl(url, {
                    method: opts.method,
                    headers,
                    body: serializedBody,
                });
            }
            catch (cause) {
                if (mayRetry && attempt < this.maxRetries) {
                    await this.delay(attempt);
                    attempt += 1;
                    continue;
                }
                throw new SolverApiNetworkError(`Request to ${opts.method} ${opts.path} failed after ${attempt + 1} attempt(s): network error.`, cause);
            }
            if (response.ok) {
                if (response.status === 204 || opts.method === "HEAD")
                    return undefined;
                return (await response.json());
            }
            if (mayRetry && isRetryableStatus(response.status) && attempt < this.maxRetries) {
                await this.delay(attempt);
                attempt += 1;
                continue;
            }
            throw await this.toApiError(response);
        }
    }
    delay(attempt) {
        const backoff = this.retryBackoffMs * 2 ** attempt;
        return new Promise((resolve) => setTimeout(resolve, backoff));
    }
    async toApiError(response) {
        let body;
        try {
            body = (await response.json());
        }
        catch (cause) {
            return new SolverApiNetworkError(`Received ${response.status} with a body that could not be parsed as a Problem response.`, cause);
        }
        return new SolverApiError(body);
    }
}
//# sourceMappingURL=httpClient.js.map