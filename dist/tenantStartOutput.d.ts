import type { Account, ExecutionResult, Receipt, TenantTemplateApplication, TenantTemplatePlan } from "./types.js";
export declare const TENANT_START_OUTPUT_VERSION = "millwork.tenant-start.v1";
export declare function tenantStartIsInteractive(args: string[], stdinTTY: boolean, stdoutTTY: boolean): boolean;
export declare function planCostSummary(plan: TenantTemplatePlan): string;
/** Agents hand over a safe application ID; never copy approval URLs to chat. */
export declare function providerConsentAction(sourceId: unknown): {
    type: string;
    detail: string;
};
export declare function browserHandoff(application: TenantTemplateApplication): {
    type: string;
    action: string;
    source_id: string | null;
    application_id: string;
    command: string[];
    npx_command: string[];
    expires_at: string | null;
    detail: string;
} | undefined;
export declare function liveProofCostSummary(application: TenantTemplateApplication): string;
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
