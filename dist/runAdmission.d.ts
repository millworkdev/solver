import type { RunAuthorizationBoundary } from "./runAuthorizationBoundary.js";
import type { DataClass, ExecutionRequest } from "./types.js";
declare const ONE_RUN_APPROVAL_BRAND: unique symbol;
declare const ONE_RUN_APPROVAL_SCHEMA = "millwork.one-run-approval/v1";
export type RunAccessLane = "byok" | "millwork_pool";
export interface RunAdmissionContext {
    account_id: string;
    request: ExecutionRequest;
    arm_id: string;
    provider_id: string;
    access_lane: RunAccessLane;
    platform_fee_usd: number | null;
}
export interface RunRequestPreview {
    request_hash: string;
    account_id: string;
    task: ExecutionRequest["task"];
    verifier_id: string;
    arm_id: string;
    provider_id: string;
    access_lane: RunAccessLane;
    policy: ExecutionRequest["policy"];
    model_budget_usd: number;
    platform_fee_usd: number | null;
    declared_maximum_usd: number | null;
}
export interface StandingRunAuthorization {
    authorization_id: string;
    coverage: {
        account_id: string;
        verifier_ids: string[];
        arm_ids: string[];
        provider_ids: string[];
        access_lanes: RunAccessLane[];
        policy: {
            data_classes: DataClass[];
            max_runtime_s: number;
            on_eval?: Array<"gate" | "fallback" | "repair_retry">;
        };
    };
    per_run_cap_usd: number;
    lifetime_cap_usd: number;
    expires_at: string;
    revoked_at?: string | null;
}
export interface OneRunApproval {
    kind: "one_run";
    approved_request_hash: string;
    /** The replay identity the host approved. One approval buys one submission. */
    approved_replay_key: string;
    /**
     * The instant the host's approval stops being an approval. It travels with
     * the capability because reading and admitting are two exported calls: a
     * caller can read before expiry, hold the value, and admit afterwards, so
     * the window has to be re-checked where a new run is actually started.
     */
    approved_not_after: string;
    readonly [ONE_RUN_APPROVAL_BRAND]: true;
}
export interface RunAdmissionGrant {
    action: "submit" | "replay" | "inspect";
    replay_key: string;
    request_hash: string;
    authorization_kind: "one_run" | "standing";
    authorization_id: string | null;
    declared_maximum_usd: number | null;
    execution_id: string | null;
}
export type RunAdmissionErrorCode = "missing_authorization" | "authorization_expired" | "authorization_revoked" | "authorization_out_of_coverage" | "charge_estimate_unavailable" | "per_run_cap_exceeded" | "aggregate_exhausted" | "approval_request_mismatch" | "approval_not_host_issued" | "approval_expired" | "replay_request_mismatch" | "replay_closed" | "authorization_file_invalid" | "admission_storage_insecure" | "admission_storage_unavailable";
export declare class RunAdmissionError extends Error {
    readonly code: RunAdmissionErrorCode;
    constructor(code: RunAdmissionErrorCode, message: string);
}
export interface RunAdmissionStoreOptions {
    /**
     * The resolved trust boundary. Only `resolveRunAuthorizationBoundary` proves
     * a real one; the store spends no effort re-deciding what that proof already
     * decided, and it can name no path the boundary did not name.
     */
    boundary: RunAuthorizationBoundary;
    now?: () => Date;
}
export declare function previewRunRequest(context: RunAdmissionContext): RunRequestPreview;
export declare function createRunReplayKey(preview: RunRequestPreview): string;
/**
 * The exact document the host writes to approve one run, and the exact place
 * it writes it. The caller may print this; it may not produce it, because the
 * directory belongs to the host principal.
 */
export declare function hostOneRunApprovalRequest(boundary: RunAuthorizationBoundary, preview: RunRequestPreview, replayKey: string): {
    approval_file: string | null;
    document: {
        schema_version: typeof ONE_RUN_APPROVAL_SCHEMA;
        account_id: string;
        request_hash: string;
        replay_key: string;
        declared_maximum_usd: number | null;
        expires_at: string;
    };
};
/**
 * Read the host's approval for exactly this request, if the host has written
 * one. Returns null when the host offers no channel or has not answered yet —
 * waiting is the caller's business, and neither waiting nor being asked in a
 * terminal is an answer.
 */
export declare function readHostOneRunApproval(boundary: RunAuthorizationBoundary, preview: RunRequestPreview, replayKey: string, now?: () => Date): Promise<OneRunApproval | null>;
export declare class RunAdmissionStore {
    private readonly boundary;
    private readonly ledgerFile;
    private readonly journalFile;
    private readonly now;
    constructor(options: RunAdmissionStoreOptions);
    /**
     * Admission answers two separate questions in a fixed order, and the order
     * is the security property.
     *
     * First: may this exact request happen at all? That is decided only by the
     * host -- by an approval it wrote where this principal cannot write. Nothing
     * this process can touch contributes to that answer.
     *
     * Only then: has it already been sent? That is a local bookkeeping question,
     * answered from this process's own journal, and it can only turn an
     * already-authorized `submit` into a `replay` or an `inspect`. A journal row
     * on its own is never a grant, so planting one buys nothing: the forger is
     * left exactly where they started, needing the host's approval.
     */
    admit(input: {
        preview: RunRequestPreview;
        replayKey: string;
        oneRunApproval?: OneRunApproval;
    }): Promise<RunAdmissionGrant>;
    markAccepted(grant: RunAdmissionGrant, executionId: string): Promise<void>;
    settle(grant: RunAdmissionGrant, chargedUsd: number): Promise<void>;
    /**
     * Settle an accepted reservation from an authoritative receipt when the
     * caller recovered through another surface (for example MCP after CLI, or
     * CLI after MCP) and therefore no longer holds the original in-memory grant.
     */
    settleAcceptedExecution(executionId: string, chargedUsd: number): Promise<boolean>;
    releaseAfterAuthoritativeRefusal(grant: RunAdmissionGrant, reason: string): Promise<void>;
    private readHostLedger;
    /**
     * Who says this run may happen. Exactly one answer is possible here: the
     * host's approval for this exact request and this exact replay identity.
     */
    private establishAuthority;
    /**
     * A standing authorization is a promise about many future runs, and a
     * promise with a lifetime cap is only worth the record of what has been
     * spent against it. In this profile that record is the host's ledger, which
     * this process cannot write -- so it cannot consume allowance, and a cap
     * that never advances is not a cap. Rather than pretend otherwise, standing
     * authorization admits nothing here and says why.
     *
     * The host's file is still inspected first, so a standing authorization the
     * caller could have edited, or one that is malformed, is still named as the
     * broken thing it is instead of being quietly stepped over.
     */
    private refuseStandingAuthorization;
    private updateReservation;
}
export {};
