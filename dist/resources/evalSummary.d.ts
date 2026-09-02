import type { HttpClient } from "../httpClient.js";
import type { EvalSummary } from "../types.js";
/** Thin wrapper over the live evaluation trend + repair-history summary. */
export declare class EvalSummaryResource {
    private readonly http;
    constructor(http: HttpClient);
    get(window?: {
        from?: string;
        to?: string;
    }): Promise<EvalSummary>;
}
