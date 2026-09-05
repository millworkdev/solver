/** Thin wrapper over the live evaluation trend + repair-history summary. */
export class EvalSummaryResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async get(window) {
        return this.http.request({
            method: "GET",
            path: "eval-summary",
            query: { from: window?.from, to: window?.to },
        });
    }
}
