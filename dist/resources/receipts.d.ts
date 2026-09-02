import type { HttpClient } from "../httpClient.js";
import type { Paginated, Receipt, ReceiptListFilter } from "../types.js";
/**
 * Thin wrappers over the live content-free receipt projection.
 */
export declare class ReceiptsResource {
    private readonly http;
    constructor(http: HttpClient);
    get(executionId: string): Promise<Receipt>;
    list(filter?: ReceiptListFilter): Promise<Paginated<Receipt>>;
}
