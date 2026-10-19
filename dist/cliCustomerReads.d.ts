import type { Solver } from "./client.js";
import type { Account } from "./types.js";
export type CustomerReadCommand = {
    kind: "account" | "balance" | "fee" | "allowance";
} | {
    kind: "usage";
    period: string;
} | {
    kind: "receipt";
    executionId: string;
} | {
    kind: "quote";
    deploymentId: string;
    providerBudgetUsd: number;
};
/** Resolve the complete read grammar before loading a key or making a request. */
export declare function resolveCustomerReadCommand(args: string[]): CustomerReadCommand | null;
/** Preserve unavailable billing as unavailable, without exposing billing contacts or ledger history. */
export declare function customerAccountSummary(account: Account): {
    tenant_id: string;
    balance: {
        balance_usd: number;
    } | null;
    billing: {
        funded_state: "funded" | "sandbox";
        manage_available: boolean;
        checkout_available?: boolean;
        payment_unavailable_reason?: "not_configured" | "mode_unverified" | "pilot_not_admitted" | "admission_unavailable" | "spending_paused" | "wallet_frozen" | null;
        platform_fee_usd_per_execution?: number;
        review_composer_fee_usd_per_execution?: number;
    } | null;
    quota: {
        executions: {
            limit: number;
            used: number;
            remaining: number;
            reset_at: string;
            retry_after_s: number;
        };
        concurrency: {
            limit: number;
            running: number;
        };
        rate_limit_rpm: number;
    };
    unavailable_reason: string | null;
    billing_path: string;
};
export declare function runCustomerReadCommand(command: CustomerReadCommand, solver: Solver): Promise<{
    document: {
        schema_version: string;
        operation: "receipt" | "account" | "usage" | "quote" | "balance" | "fee" | "allowance";
        read_only: boolean;
        data: unknown;
    };
    human: string;
}>;
