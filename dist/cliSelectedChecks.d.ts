import type { Solver } from "./client.js";
export type SelectedChecksCommand = {
    action: "plan";
    inputPath: string;
} | {
    action: "status" | "operation-status";
    id: string;
} | {
    action: "start";
    inputPath: string;
    idempotencyKey: string;
} | {
    action: "resume" | "cancel";
    id: string;
    inputPath: string;
    idempotencyKey: string;
};
/** Resolve all arguments before credentials, files or network access. --yes is not paid approval. */
export declare function resolveSelectedChecksCommand(args: string[]): SelectedChecksCommand | null;
export declare function selectedChecksReadOnly(command: SelectedChecksCommand): boolean;
/** The existing host authority covers one run, never an entire batch or a resumed approval. */
export declare function selectedChecksPaidRefusal(command: SelectedChecksCommand): Record<string, unknown> | null;
/** Preserve original identity on transport/API failure; no retry, new key, fresh revision or inferred refund. */
export declare function selectedChecksFailure(command: SelectedChecksCommand, error: unknown): Record<string, unknown> | null;
/** Thin SDK bindings. Paid boundaries run before opening even the input file. */
export declare function runSelectedChecksCommand(command: SelectedChecksCommand, solver: Solver): Promise<Record<string, unknown>>;
