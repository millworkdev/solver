import type { HttpClient } from "../httpClient.js";
import type { ByokBatchRequest, ByokBatchPlan, ByokBatchWire, ByokBatchMutation, ByokAuthorityWire, ByokAuthorityOperation, ByokConfirmRequest, ByokImportWire, ByokInventoryFacets, ByokInventoryFilter, ByokInventoryItemDetail, ByokInventoryPage, ByokPlanRequest, ByokPlanWire, ByokQuoteRequest, ByokQuoteWire } from "../modelInventory.js";
/**
 * Account inventory is separate from the tested catalog. Planning is a fresh
 * read-only computation; authorization records permission for the reviewed
 * route envelope. Neither operation adds an arm or approves a paid task.
 */
export declare class ModelInventoryResource {
    private readonly http;
    constructor(http: HttpClient);
    /** Return the full server snapshot/count metadata; do not derive totals from this page. */
    list(filter?: ByokInventoryFilter): Promise<ByokInventoryPage>;
    facets(filter?: ByokInventoryFilter): Promise<ByokInventoryFacets>;
    get(itemId: string): Promise<ByokInventoryItemDetail>;
    /** Refresh metadata only; this starts no inference, authorization or arm registration. */
    importConnection(connectionId: string, options: {
        idempotencyKey: string;
    }): Promise<ByokImportWire>;
    importStatus(importId: string): Promise<ByokImportWire>;
    plan(input: ByokPlanRequest): Promise<ByokPlanWire>;
    /** Retry an uncertain issuance with the same original inputs and caller key. */
    authorize(input: ByokConfirmRequest, options: {
        idempotencyKey: string;
    }): Promise<ByokAuthorityWire>;
    authority(authorityId: string): Promise<ByokAuthorityWire>;
    /** Reconcile the original principal's operation after an uncertain issuance, even after its deadline. */
    authorizationOperation(operationKey: string): Promise<ByokAuthorityOperation>;
    /** An execute-plan quote does not grant host approval or submit an execution. */
    quote(input: ByokQuoteRequest): Promise<ByokQuoteWire>;
    /** Metadata/price planning only. Exact selected IDs and original snapshot remain caller-owned. */
    planChecks(input: ByokBatchRequest): Promise<ByokBatchPlan>;
    /** Explicitly approve the exact returned plan; retain its payload/key across uncertain responses. */
    startChecks(plan: ByokBatchPlan, options: {
        idempotencyKey: string;
    }): Promise<ByokBatchWire>;
    checks(batchId: string): Promise<ByokBatchWire>;
    checkOperation(operationKey: string): Promise<ByokBatchWire>;
    /** Explicit CAS: only untouched work; preserve exact acknowledged unknown IDs and fresh plan if reviewed. */
    resumeChecks(batchId: string, input: ByokBatchMutation, options: {
        idempotencyKey: string;
    }): Promise<ByokBatchWire>;
    cancelChecks(batchId: string, input: ByokBatchMutation, options: {
        idempotencyKey: string;
    }): Promise<ByokBatchWire>;
}
