/**
 * Curated model discovery. `definitions()` lists publisher-true model
 * identity records (metadata only -- never usable supply by itself);
 * `get()` answers the tenant's USABLE catalog: the evidence-backed
 * intersection of certified offering x tested customer-owned connection x tested
 * deployment, each entry carrying a secretless arm_registration_template.
 */
export class ModelCatalogResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async definitions() {
        return this.http.request({
            method: "GET",
            path: "model-definitions",
        });
    }
    async get() {
        return this.http.request({
            method: "GET",
            path: "model-catalog",
        });
    }
}
