/** Thin wrapper over the live period-scoped AUD2 compliance artifact. */
export class ComplianceExportsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async get(period) {
        return this.http.request({
            method: "GET",
            path: "compliance-export",
            query: typeof period === "string" ? { period } : { from: period.from, to: period.to },
        });
    }
}
