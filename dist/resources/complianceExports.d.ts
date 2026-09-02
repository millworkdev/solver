import type { HttpClient } from "../httpClient.js";
import type { ComplianceExportBundle } from "../types.js";
export type ComplianceExportPeriod = {
    from: string;
    to: string;
} | string;
/** Thin wrapper over the live period-scoped AUD2 compliance artifact. */
export declare class ComplianceExportsResource {
    private readonly http;
    constructor(http: HttpClient);
    get(period: ComplianceExportPeriod): Promise<ComplianceExportBundle>;
}
