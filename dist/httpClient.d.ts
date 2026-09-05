export interface SolverClientOptions {
    apiKey: string;
    baseUrl: string;
    /**
     * Maximum AUTOMATIC retries, and only for requests inside the safe-transport
     * boundary (see requestRetryBoundary). A 4xx is never retried, and neither is
     * a mutation the caller did not give an idempotency key. Default 2.
     */
    maxRetries?: number;
    /** Base of the exponential backoff (ms). Default 500. */
    retryBackoffMs?: number;
    /** Injectable for tests; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
}
export interface RequestOptions {
    method: "GET" | "HEAD" | "POST" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    idempotencyKey?: string;
}
/**
 * Which side of the safe-transport boundary a request sits on.
 * Mirrors the MCP transport's vocabulary (the transport boundary) so the two surfaces describe
 * one invariant in one language rather than two dialects of it.
 */
export type RequestRetryBoundary = "safe_read" | "same_key_mutation" | "single_attempt_mutation";
/**
 * Security invariant 6 (the retry boundary). An automatic retry is only safe when
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
export declare function requestRetryBoundary(request: Pick<RequestOptions, "method" | "idempotencyKey">): RequestRetryBoundary;
/**
 * Thin fetch-based HTTP client: auth header, JSON encode/decode, typed
 * SolverApiError on any non-2xx, and automatic retry of network errors and 5xx
 * ONLY inside the safe-transport boundary (never a 4xx, never an unkeyed
 * mutation -- see requestRetryBoundary). Per the SDK documentation's "thin client,
 * no hidden logic" rule -- no ranking/policy/caching behavior lives here.
 */
export declare class HttpClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly maxRetries;
    private readonly retryBackoffMs;
    private readonly fetchImpl;
    constructor(opts: SolverClientOptions);
    request<T>(opts: RequestOptions): Promise<T>;
    private delay;
    private toApiError;
}
