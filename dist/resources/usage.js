/** Thin wrapper over the live tenant usage projection. */
export class UsageResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async get(period) {
        return this.http.request({
            method: "GET",
            path: "usage",
            query: typeof period === "string" ? { period } : { from: period.from, to: period.to },
        });
    }
}
//# sourceMappingURL=usage.js.map