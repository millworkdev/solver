export class TenantTemplatesResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async list() {
        return this.http.request({ method: "GET", path: "tenant-templates" });
    }
    async plan(input = {}) {
        return this.http.request({
            method: "POST",
            path: "tenant-template-plans",
            body: input,
        });
    }
    async apply(input, opts) {
        return this.http.request({
            method: "POST",
            path: "tenant-template-applications",
            body: input,
            idempotencyKey: opts.idempotencyKey,
        });
    }
    async get(applicationId) {
        return this.http.request({
            method: "GET",
            path: `tenant-template-applications/${encodeURIComponent(applicationId)}`,
        });
    }
    async recover(input) {
        return this.http.request({ method: "GET", path: "tenant-template-applications", query: input });
    }
    async resume(applicationId, input, opts) {
        return this.http.request({
            method: "POST",
            path: `tenant-template-applications/${encodeURIComponent(applicationId)}/resume`,
            body: input,
            idempotencyKey: opts.idempotencyKey,
        });
    }
}
