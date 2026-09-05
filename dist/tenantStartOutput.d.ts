import type { Account, ExecutionResult, Receipt, TenantTemplateApplication } from "./types.js";
export declare const TENANT_START_OUTPUT_VERSION = "millwork.tenant-start.v1";
export declare function tenantStartIsInteractive(args: string[], stdinTTY: boolean, stdoutTTY: boolean): boolean;
/** Model output, API details and identifiers are data, never terminal commands. */
export declare function terminalText(value: unknown, multiline?: boolean): string;
export type CreditSummary = {
    status: "available";
    balance_usd: number;
} | {
    status: "not_visible" | "unavailable";
};
/** Do not emit billing emails, ledger activity, or a guessed zero on failure. */
export declare function readCreditSummary(read: () => Promise<Account>): Promise<CreditSummary>;
export interface TenantStartOutputExtras {
    output?: ExecutionResult;
    execution_receipt?: Receipt;
    credit?: CreditSummary;
    files?: {
        written: string[];
        skipped_existing: string[];
    };
}
export declare function applicationSummary(application: TenantTemplateApplication, extras: TenantStartOutputExtras): string;
