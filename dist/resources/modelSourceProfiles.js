/**
 * Read-only discovery of the registered model sources a tenant may connect
 * (`GET /v1/model-source-profiles`). The listing is customer-owned-only by
 * construction: platform-owned sources never appear on this surface.
 */
export class ModelSourceProfilesResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async list() {
        return this.http.request({
            method: "GET",
            path: "model-source-profiles",
        });
    }
}
