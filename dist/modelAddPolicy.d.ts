import type { DataClass, ModelCatalogEntry } from "./types.js";
export interface ModelAddPolicyInput {
    displayName?: string;
    capabilityTags?: readonly string[];
    clearCapabilityTags?: boolean;
    dataClassGrants?: readonly string[];
}
export type NormalizedModelAddRequest = Readonly<{
    kind: "model";
    display_name: string;
    model_deployment_id: string;
    capability_tags: string[];
    data_class_grants: DataClass[];
    cost_class: "standard";
}>;
export declare class ModelAddPolicyError extends Error {
    constructor(message: string);
}
export declare function normalizeModelAddRequest(row: ModelCatalogEntry, input?: ModelAddPolicyInput): NormalizedModelAddRequest;
export declare function modelAddOperationKey(request: NormalizedModelAddRequest): `models-add:v2:sha256:${string}`;
