const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "expired"]);
const EVENT_POLL_INTERVAL_MS = 1_000;
/**
 * Thin wrappers over the live execution routes. The caller owns the required
 * idempotency key; retries therefore preserve the same execution attempt.
 */
export class ExecutionsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async create(input, opts) {
        return this.http.request({
            method: "POST",
            path: "executions",
            body: input,
            idempotencyKey: opts.idempotencyKey,
        });
    }
    async get(executionId) {
        return this.http.request({
            method: "GET",
            path: `executions/${encodeURIComponent(executionId)}`,
        });
    }
    /** Fetches the retention-bound result of a COMPLETED execution, with the
     * winner attempt's model provenance when one exists. */
    async result(executionId) {
        return this.http.request({
            method: "GET",
            path: `executions/${encodeURIComponent(executionId)}/result`,
        });
    }
    async cancel(executionId) {
        return this.http.request({
            method: "POST",
            path: `executions/${encodeURIComponent(executionId)}/cancel`,
        });
    }
    async *events(executionId) {
        let after;
        for (;;) {
            const response = await this.http.request({
                method: "GET",
                path: `executions/${encodeURIComponent(executionId)}/events`,
                query: { after },
            });
            for (const event of response.events) {
                after = event.event_id;
                yield event;
                if (event.slice_id === undefined && event.type === "lifecycle" && TERMINAL_STATES.has(String(event.state))) {
                    return;
                }
            }
            if (response.events.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, EVENT_POLL_INTERVAL_MS));
            }
        }
    }
}
