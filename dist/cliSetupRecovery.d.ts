import type { TenantTemplatesResource } from "./resources/tenantTemplates.js";
import type { TenantTemplateId } from "./types.js";
export type ApprovedSetupRequest = Omit<Parameters<TenantTemplatesResource["apply"]>[0], "application_key"> & {
    template_id: TenantTemplateId;
    write: boolean;
};
export interface SetupRecoveryScope {
    apiBaseUrl: string;
    principalId: string;
    derivedKey: string;
}
export interface SetupRecoveryRecord {
    schema_version: 1;
    scope_sha256: string;
    request_sha256: string;
    application_key: string;
    request: ApprovedSetupRequest;
}
export declare const setupRequestHash: (request: ApprovedSetupRequest) => string;
export declare class SetupRecoveryStorageError extends Error {
    constructor();
}
/** No API keys, prompts or private URLs are stored. A scope gets one immutable
 * replacement identity; it is retained after success so replay stays replay. */
export declare function loadSetupRecovery(scope: SetupRecoveryScope, environment?: NodeJS.ProcessEnv): Promise<SetupRecoveryRecord | undefined>;
/** Publish a complete, fsynced record with an atomic no-replace hard link.
 * Concurrent processes either publish once or read the same winner. A partial
 * file is never visible at the stable path, and storage failure precedes apply. */
export declare function claimSetupRecovery(scope: SetupRecoveryScope, request: ApprovedSetupRequest, environment?: NodeJS.ProcessEnv): Promise<SetupRecoveryRecord>;
export declare function setupRecoveryCommand(record: SetupRecoveryRecord): string[];
