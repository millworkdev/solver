import type { Solver } from "./client.js";
import { type Qualification } from "./cliQualification.js";
import type { Account, TenantTemplateId } from "./types.js";
export type InspectionCommand = {
    kind: "plan";
    templateId: TenantTemplateId;
    modelDeploymentId?: string;
} | {
    kind: "show";
    templateId?: TenantTemplateId;
    applicationId?: string;
    applicationKey?: string;
} | {
    kind: "models";
};
export declare class InspectionUsageError extends Error {
}
/** Parse before constructing a client: a preview flag can never reach resume/apply. */
export declare function resolveInspectionCommand(args: string[]): InspectionCommand | null;
export declare function inspectionVersion(command: InspectionCommand): string;
export interface InspectionResult {
    exitCode: number;
    document: Record<string, unknown>;
    human: string;
}
export declare function inspectionQualification(command: InspectionCommand, qualification: Qualification): InspectionResult;
export declare function inspectionApiError(command: InspectionCommand, error: unknown): InspectionResult | null;
type InspectionResources = {
    tenantTemplates: Pick<Solver["tenantTemplates"], "plan" | "get" | "recover">;
    modelCatalog: Pick<Solver["modelCatalog"], "get">;
};
/** Only stateless plan and GET resource methods are available to this path. */
export declare function inspectCommand(command: InspectionCommand, solver: InspectionResources, readAccount: () => Promise<Account>): Promise<InspectionResult>;
export {};
