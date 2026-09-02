import type { HttpClient } from "../httpClient.js";
import type { Usage } from "../types.js";
/** Thin wrapper over the live tenant usage projection. */
export declare class UsageResource {
    private readonly http;
    constructor(http: HttpClient);
    get(period: {
        from: string;
        to: string;
    } | string): Promise<Usage>;
}
