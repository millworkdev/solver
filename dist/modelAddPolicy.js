import { createHash } from "node:crypto";
export class ModelAddPolicyError extends Error {
    constructor(message) {
        super(message);
        this.name = "ModelAddPolicyError";
    }
}
function orderedCertifiedSubset(selected, certified, label) {
    if (new Set(selected).size !== selected.length) {
        throw new ModelAddPolicyError(`${label} contains a repeated value.`);
    }
    const certifiedSet = new Set(certified);
    const outside = selected.find((value) => !certifiedSet.has(value));
    if (outside !== undefined) {
        throw new ModelAddPolicyError(`${label} ${JSON.stringify(outside)} is outside the current certified template.`);
    }
    const selectedSet = new Set(selected);
    return certified.filter((value) => selectedSet.has(value));
}
export function normalizeModelAddRequest(row, input = {}) {
    const template = row.arm_registration_template;
    if (template.kind !== "model" || template.cost_class !== "standard") {
        throw new ModelAddPolicyError("This catalog route does not carry the required standard model-arm template.");
    }
    if (input.clearCapabilityTags && input.capabilityTags !== undefined) {
        throw new ModelAddPolicyError("--clear-capability-tags cannot be combined with --capability-tag.");
    }
    const displayName = (input.displayName ?? template.display_name).trim();
    if (!displayName)
        throw new ModelAddPolicyError("display_name is required.");
    const capabilityTags = input.clearCapabilityTags
        ? []
        : input.capabilityTags === undefined
            ? [...template.capability_tags]
            : orderedCertifiedSubset(input.capabilityTags, template.capability_tags, "capability tag");
    const dataClassGrants = input.dataClassGrants === undefined
        ? [...template.data_class_grants]
        : orderedCertifiedSubset(input.dataClassGrants, template.data_class_grants, "data class");
    if (dataClassGrants.length === 0) {
        throw new ModelAddPolicyError("At least one certified data class is required.");
    }
    return {
        kind: "model",
        display_name: displayName,
        model_deployment_id: template.model_deployment_id,
        capability_tags: capabilityTags,
        data_class_grants: dataClassGrants,
        cost_class: "standard",
    };
}
function canonicalStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalStringify).join(",")}]`;
    const object = value;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(object[key])}`).join(",")}}`;
}
export function modelAddOperationKey(request) {
    const digest = createHash("sha256").update(canonicalStringify(request), "utf8").digest("hex");
    return `models-add:v2:sha256:${digest}`;
}
