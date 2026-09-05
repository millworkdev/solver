import type { HttpClient } from "../httpClient.js";
import type { SourceProfileListing } from "../types.js";
/**
 * Read-only discovery of the registered model sources a tenant may connect
 * (`GET /v1/model-source-profiles`). The listing is customer-owned-only by
 * construction: platform-owned sources never appear on this surface.
 */
export declare class ModelSourceProfilesResource {
    private readonly http;
    constructor(http: HttpClient);
    list(): Promise<SourceProfileListing>;
}
