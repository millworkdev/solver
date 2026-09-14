import type { Account, ExecutionResult, Receipt, TenantTemplateApplication, TenantTemplatePlan } from "./types.js";
export declare const TENANT_START_OUTPUT_VERSION = "millwork.tenant-start.v1";
export declare function tenantStartIsInteractive(args: string[], stdinTTY: boolean, stdoutTTY: boolean): boolean;
export declare function planCostSummary(plan: TenantTemplatePlan): string;
/** Agents hand over a safe application ID; never copy approval URLs to chat. */
export declare function providerConsentAction(sourceId: unknown, authScheme?: unknown): {
    type: string;
    detail: string;
    provider_access_url?: undefined;
} | {
    type: string;
    detail: string;
    provider_access_url: string;
};
export declare function browserHandoff(application: TenantTemplateApplication): {
    detail: string;
    provider_access_url?: string | undefined;
    type: string;
    action: string;
    source_id: string | null;
    application_id: string;
    command: string[];
    npx_command: string[];
    expires_at: string | null;
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
/** A recovered ready application is historical success, not a newly submitted run. */
export declare function readySetupRecovery(application: TenantTemplateApplication, noBrowser?: boolean): {
    type: "existing_ready_setup";
    application_id: string;
    completed_at: string | null;
    model_key: string | null;
    model_deployment_id: string | null;
    new_setup: {
        command: string[];
        detail: string;
    };
} | undefined;
export declare function newSetupPlanOutput(plan: TenantTemplatePlan, applicationKey: string, write: boolean): {
    state: string;
    application_key: string;
    plan: TenantTemplatePlan;
    next_action: {
        type: string;
        detail: string;
        command?: undefined;
    } | {
        type: string;
        command: string[];
        detail: string;
    };
};
export interface TenantStartOutputExtras {
    setup_recovery?: ReturnType<typeof readySetupRecovery>;
    output?: ExecutionResult;
    execution_receipt?: Receipt;
    credit?: CreditSummary;
    files?: {
        written: string[];
        skipped_existing: string[];
    };
    /** Set only when a CLI-derived request key conflicted and one fresh key was applied instead. */
    retried_with_fresh_key?: true;
    application_key?: string;
}
/**
 * Model usage and Millwork's fee after refunds are separate receipt lines.
 * Millwork or the provider bills model usage, depending on the saved model.
 * A partial receipt never shows a made-up amount.
 */
export declare function receiptCostLines(receipt: Receipt | undefined): string[];
export declare function applicationSummary(application: TenantTemplateApplication, extras: TenantStartOutputExtras): string;
