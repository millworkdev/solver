import type { HttpClient } from "../httpClient.js";
import type { TenantTemplateApplication, TenantTemplateId, TenantTemplatePlan } from "../types.js";
export declare class TenantTemplatesResource {
    private readonly http;
    constructor(http: HttpClient);
    list(): Promise<{
        templates: Array<{
            template_id: TenantTemplateId;
            template_version: string;
            access_lane: "diagnostic" | "millwork_pool" | "byok";
            eligible: boolean;
            blockers: TenantTemplatePlan["blockers"];
            alternative_plans: TenantTemplatePlan["alternative_plans"];
            catalog_row: TenantTemplatePlan["catalog_row"];
        }>;
    }>;
    plan(input?: {
        template_id?: TenantTemplateId;
        model_deployment_id?: string;
    }): Promise<TenantTemplatePlan>;
    apply(input: {
        digest: string;
        /** Durable journey identity, independent of each approved HTTP operation. */
        application_key?: string;
        issued_at: string;
        template_id?: TenantTemplateId;
        model_deployment_id?: string;
        write?: boolean;
    }, opts: {
        idempotencyKey: string;
    }): Promise<TenantTemplateApplication>;
    get(applicationId: string): Promise<TenantTemplateApplication>;
    recover(input: {
        template_id: TenantTemplateId;
        idempotency_key: string;
    }): Promise<{
        application: TenantTemplateApplication | null;
    }>;
    resume(applicationId: string, input: {
        action: "poll_consent" | "retry_consent" | "retry_connection_test" | "retry_deployment_sync" | "authorize_live_proof" | "refresh_pool_readiness" | "refresh_byok_readiness";
        live_proof_digest?: string;
    }, opts: {
        idempotencyKey: string;
    }): Promise<TenantTemplateApplication>;
}
