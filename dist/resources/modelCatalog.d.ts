import type { HttpClient } from "../httpClient.js";
import type { ModelCatalog, ModelDefinitionListing, TestedByokQuote } from "../types.js";
/**
 * Curated model discovery. `definitions()` lists publisher-true model
 * identity records (metadata only -- never usable supply by itself);
 * `get()` answers the tenant's USABLE catalog: the evidence-backed
 * intersection of certified offering x tested customer-owned connection x tested
 * deployment, each entry carrying a secretless arm_registration_template.
 */
export declare class ModelCatalogResource {
    private readonly http;
    constructor(http: HttpClient);
    definitions(): Promise<ModelDefinitionListing>;
    /** Commercial consent only; the server rechecks route eligibility at admission. */
    quote(input: {
        model_deployment_id: string;
        provider_usage_budget_usd: number;
    }): Promise<TestedByokQuote>;
    get(): Promise<ModelCatalog>;
}
