import type { HttpClient } from "../httpClient.js";
import type { Execution, ExecutionRequest, ExecutionResult, LifecycleEvent } from "../types.js";
/**
 * Thin wrappers over the live execution routes. The caller owns the required
 * idempotency key; retries therefore preserve the same execution attempt.
 */
export declare class ExecutionsResource {
    private readonly http;
    constructor(http: HttpClient);
    create(input: ExecutionRequest, opts: {
        idempotencyKey: string;
    }): Promise<Execution>;
    get(executionId: string): Promise<Execution>;
    /** Fetches the retention-bound result of a COMPLETED execution, with the
     * winner attempt's model provenance when one exists. */
    result(executionId: string): Promise<ExecutionResult>;
    cancel(executionId: string): Promise<Execution>;
    events(executionId: string): AsyncIterable<LifecycleEvent>;
}
