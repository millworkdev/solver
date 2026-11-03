import type { Solver } from "./client.js";
import type { ByokInventoryFilter, ByokInventoryApproval } from "./modelInventory.js";
export type InventoryCommand = {
    action: "list" | "facets";
    filter: ByokInventoryFilter;
} | {
    action: "show" | "authority" | "import-status" | "authorization-status";
    id: string;
} | {
    action: "refresh";
    connectionId: string;
    idempotencyKey: string;
} | {
    action: "plan" | "quote";
    inputPath: string;
} | {
    action: "authorize" | "add";
    inputPath: string;
    idempotencyKey: string;
};
/** Resolve the entire grammar before key lookup, file loading or network access. */
export declare function resolveInventoryCommand(args: string[]): InventoryCommand | null;
export declare function inventoryCommandReadOnly(command: InventoryCommand): boolean;
/** Thin operations only: no paid task, automatic replan, inferred template or replacement key. */
export declare function runInventoryCommand(command: InventoryCommand, solver: Solver): Promise<Record<string, unknown>>;
/** Load the original reviewed execute consent; never mint or refresh it here. */
export declare function readInventoryRunApproval(path: string): Promise<ByokInventoryApproval>;
