import type { ExecutionRequest, Receipt } from "./types.js";
/** Customer-facing terminal detail for the receipt returned by a completed or inspected run. */
export declare function runResultLines(receipt: Receipt): string[];
/** Exact task/check/policy facts shown before the customer approves a paid run. */
export declare function runPreviewLines(request: ExecutionRequest): string[];
