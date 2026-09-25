export declare const RUN_AUTHORIZATION_BOUNDARY_SCHEMA = "millwork.run-authorization-boundary/v1";
export declare const HOST_RUN_AUTHORIZATION_ATTESTATION_FILE = "/etc/millwork/run-authorization-boundary.json";
export declare const HOST_ISOLATED_PRINCIPAL_PROFILE = "host_isolated_principal";
/**
 * Environment names that used to select the authorization file, the admission
 * ledger, or the agent-writable roots. They are withdrawn rather than ignored:
 * a launch environment that still carries one is reporting an attempt to choose
 * run authority, and the honest answer to that attempt is a refusal.
 */
export declare const WITHDRAWN_RUN_AUTHORITY_ENVIRONMENT_NAMES: readonly ["MILLWORK_RUN_AUTHORIZATION_FILE", "MILLWORK_RUN_ADMISSION_LEDGER_FILE", "MILLWORK_AGENT_WRITABLE_ROOTS"];
export type UnsupportedRunBoundaryReason = "launch_environment_override" | "host_principal_unavailable" | "attestation_missing" | "attestation_not_host_owned" | "attestation_invalid" | "authorization_file_not_host_owned" | "ledger_directory_unusable" | "ledger_file_not_host_owned" | "approval_channel_unavailable" | "approval_channel_not_host_owned" | "recovery_journal_not_caller_owned";
export interface HostOneRunApprovalChannel {
    kind: "host_approved_file";
    directory: string;
}
export interface RunAuthorizationBoundary {
    /** The attestation that established this boundary, for truthful reporting. */
    attestationFile: string;
    profile: string;
    /** The principal that owns the attestation. It is never the process principal. */
    hostPrincipalUid: number;
    /** Absent when the host publishes no standing authority at all. */
    authorizationFile: string | null;
    /**
     * The host's own admission record. It is read-only to this process: the
     * directory it lives in belongs to the host principal and grants this
     * principal no write, so what the host has recorded there can restrict a run
     * but can never be edited into permission for one.
     */
    ledgerFile: string;
    /**
     * Where this process records its own in-flight reservations. This principal
     * owns it and can rewrite it, so it carries no authority whatsoever: it only
     * lets an already-authorized admission tell a recovery from a new run. The
     * boundary still checks it, so that no *third* principal can forge into it.
     */
    recoveryJournalFile: string;
    /**
     * The one-run approval channel. `resolveRunAuthorizationBoundary` never
     * returns a boundary without one, because with a read-only ledger nothing
     * else in this profile can authorize a paid run; the field stays nullable
     * only so callers can describe a boundary that has not been resolved.
     */
    approvalChannel: HostOneRunApprovalChannel | null;
}
export interface UnsupportedRunBoundary {
    supported: false;
    reason: UnsupportedRunBoundaryReason;
    detail: string;
    attestationFile: string;
}
export type RunAuthorizationBoundaryResolution = {
    supported: true;
    boundary: RunAuthorizationBoundary;
} | UnsupportedRunBoundary;
export interface ResolveRunAuthorizationBoundaryOptions {
    /**
     * Only a caller holding this module may name another attestation, and that
     * attestation still has to be owned by another principal. There is
     * deliberately no environment variable for it.
     */
    attestationFile?: string;
    environment?: NodeJS.ProcessEnv;
}
interface OwnershipFailure {
    path: string;
    detail: string;
}
/**
 * True host ownership: the path, and every directory above it, belongs to a
 * principal this process is not, and no one but that principal may write it.
 *
 * There is deliberately no exemption here. An earlier revision let the ledger
 * directory be group-writable, on the reasoning that group write is how a host
 * hands the CLI principal its own reservation store. It is also how the CLI
 * principal deletes or rewrites that store: with group write, the process that
 * spends the allowance is the process that keeps the record of having spent it,
 * so one `unlink` — or one plain overwrite — resets the history the next
 * admission is checked against. Group write on the ledger directory is
 * therefore no different from no boundary at all.
 */
export declare function hostOwnedChainFailure(path: string, uid: number, hostPrincipalUid?: number): Promise<OwnershipFailure | null>;
export interface ParsedHostAttestation {
    ledgerFile: string;
    recoveryJournalFile: string;
    authorizationFile: string | null;
    approvalChannel: HostOneRunApprovalChannel | null;
}
/**
 * The document half of the boundary, separated from the ownership half so the
 * shape rules can be exercised directly. Parsing decides what the host asked
 * for; only ownership decides whether the host was the one asking.
 */
export declare function parseHostAttestation(document: unknown, attestationFile: string): {
    ok: true;
    attestation: ParsedHostAttestation;
} | {
    ok: false;
    detail: string;
};
/**
 * Resolve the run-authorization trust boundary for this process. A supported
 * result is a capability: the admission store trusts the paths it names because
 * this function proved another principal owns them. Every other result refuses,
 * and says which check failed rather than implying the run could work elsewhere.
 */
export declare function resolveRunAuthorizationBoundary(options?: ResolveRunAuthorizationBoundaryOptions): Promise<RunAuthorizationBoundaryResolution>;
/** The refusal a caller must report when no paid run can be authorized here. */
export declare function unsupportedRunBoundaryReport(resolution: UnsupportedRunBoundary): {
    refusal_code: "unsupported_run_authorization_boundary";
    reason: UnsupportedRunBoundaryReason;
    detail: string;
    attestation_file: string;
    supported_profile: string;
};
export {};
