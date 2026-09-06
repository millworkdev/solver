import type { TenantTemplatesResource } from "./resources/tenantTemplates.js";
import type { TenantTemplateApplication, TenantTemplateId } from "./types.js";
/** Stable, tenant-scoped server identity. No API-key hash or project file cache. */
export declare function tenantStartKey(template: TenantTemplateId): string;
export interface TenantStartProgressOptions {
    interactive: boolean;
    approveLive: (application: TenantTemplateApplication) => Promise<boolean>;
    progress: (application: TenantTemplateApplication) => void;
    presentConsent?: (application: TenantTemplateApplication, continueUrl: string) => unknown | Promise<unknown>;
    approveConsentRetry?: (application: TenantTemplateApplication) => Promise<boolean>;
    sleep?: (ms: number) => Promise<void>;
    maxPolls?: number;
}
/** Current hosted action only; callback/code handling stays with the authenticated host. */
export declare function hostedConsentUrl(application: TenantTemplateApplication): string | undefined;
/** CLI orchestration only. Every durable milestone and spend gate stays server-owned. */
export declare function progressTenantStart(templates: Pick<TenantTemplatesResource, "get" | "resume">, initial: TenantTemplateApplication, options: TenantStartProgressOptions): Promise<TenantTemplateApplication>;
