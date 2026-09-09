import type { Solver } from "./client.js";
import type { Qualification } from "./cliQualification.js";
type LifecycleClient = Pick<Solver, "modelSourceProfiles" | "sourceConnections" | "sourceCredentialHandoffs" | "modelDeployments" | "arms" | "tenantTemplates">;
export type ProviderLifecycleCommand = {
    kind: "list";
} | {
    kind: "rotate" | "disconnect";
    connectionId: string;
    yes: boolean;
    handoffId?: string;
    idempotencyKey?: string;
    openBrowser: boolean;
    noBrowser: boolean;
};
interface LifecycleUI {
    interactive: boolean;
    confirm(question: string): Promise<boolean>;
    write(message: string): void;
    present?: (input: {
        sourceId: unknown;
        url: string;
        expiresAt: string;
    }) => Promise<void>;
    sleep?: (milliseconds: number) => Promise<void>;
    maxPolls?: number;
}
/** Keep read failures separate from mutation/idempotency errors at the CLI boundary. */
export declare class ProviderInspectionError extends Error {
    readonly qualification: Qualification;
    constructor(qualification: Qualification);
}
/** Parse before any request. No credential-valued command-line option exists. */
export declare function resolveProviderLifecycleCommand(args: string[]): ProviderLifecycleCommand | null;
/** Orchestrates the existing REST lifecycle; never stores a secret or starts an execution. */
export declare function runProviderLifecycle(solver: LifecycleClient, input: ProviderLifecycleCommand, ui: LifecycleUI): Promise<Record<string, unknown>>;
export declare function providerLifecycleSummary(document: Record<string, unknown>): string;
export {};
