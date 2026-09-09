import type { TenantTemplatesResource } from "./resources/tenantTemplates.js";
import type { TenantTemplateApplication, TenantTemplatePlan } from "./types.js";
export type ByokChoice = Pick<NonNullable<TenantTemplatePlan["byok_source"]>, "source_id" | "auth_scheme" | "served_variant_id">;
export type ByokChoiceFilter = {
    sourceId?: string;
    servedVariantId?: string;
};
export type ByokOffering = NonNullable<TenantTemplatePlan["byok_source"]>;
export declare function byokChoice(offering: ByokOffering): ByokChoice;
/** Reuse the server's configured/certified choices; never invent a catalog or choose its first row. */
export declare function planByokChoice(templates: Pick<TenantTemplatesResource, "plan">, input: ByokChoiceFilter & {
    modelDeploymentId?: string;
}, choose?: (offerings: ByokOffering[]) => Promise<ByokOffering | undefined>): Promise<TenantTemplatePlan | undefined>;
/** A saved application wins over current configuration, but never over an explicit conflicting choice. */
export declare function assertRecoveredByokChoice(application: TenantTemplateApplication, filter: ByokChoiceFilter): void;
