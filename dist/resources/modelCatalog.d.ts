import type { HttpClient } from "../httpClient.js";
import type { ModelCatalog, ModelDefinitionListing } from "../types.js";
/**
 * Curated model discovery. `definitions()` lists publisher-true model
 * identity records (metadata only -- never usable supply by itself);
 * `get()` answers the tenant's USABLE catalog: the evidence-backed
 * intersection of certified offering x tested provider-key connection x tested
 * deployment, each entry carrying a secretless arm_registration_template.
 */
export declare class ModelCatalogResource {
    private readonly http;
    constructor(http: HttpClient);
    definitions(): Promise<ModelDefinitionListing>;
    get(): Promise<ModelCatalog>;
}
