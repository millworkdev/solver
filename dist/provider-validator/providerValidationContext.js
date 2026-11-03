import { Ajv } from 'ajv';
import { containsProviderCredentialMaterial } from './providerMetadataPolicy.js';
import { PROVIDER_CANDIDATE_PROTOCOLS, PROVIDER_VALIDATOR_VERSION } from './providerValidator.js';
const text = { type: 'string', minLength: 1, maxLength: 256 };
const closed = (properties) => ({
    type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});
const list = (items, maxItems = 10000) => ({ type: 'array', maxItems, items });
export const PROVIDER_PORTABLE_VALIDATION_CONTEXT_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['modelKeys'],
    properties: {
        modelKeys: { ...list(text), uniqueItems: true },
        reservedModelPins: list(closed({ model_key: text, lifecycle: { enum: ['preview', 'active'] },
            route_capabilities: { type: 'array', items: { const: 'text_nonstream' }, minItems: 1, maxItems: 1 } })),
        validator_version: { const: PROVIDER_VALIDATOR_VERSION },
        incumbentSources: list(closed({
            source_id: text, source_kind: { enum: ['publisher_direct', 'gateway', 'cloud'] },
            protocol_profiles: { ...list({ enum: PROVIDER_CANDIDATE_PROTOCOLS }, 5), uniqueItems: true },
            static_route_ids: { ...list(text), uniqueItems: true },
            static_routes: list(closed({ model_id: text, protocol: { enum: PROVIDER_CANDIDATE_PROTOCOLS }, region: text })),
            candidate_releases: list(closed({ model_key: text, model_id: text }), 200),
            gateway_pairs: list(closed({ model_key: text, model_id: text, upstream_ref: text }), 200),
        }), 100),
    },
};
export const PROVIDER_ISSUED_VALIDATION_CONTEXT_SCHEMA = {
    ...PROVIDER_PORTABLE_VALIDATION_CONTEXT_SCHEMA,
    required: ['modelKeys', 'validator_version', 'incumbentSources'],
};
const validate = new Ajv({ allErrors: true, removeAdditional: false, coerceTypes: false })
    .compile(PROVIDER_PORTABLE_VALIDATION_CONTEXT_SCHEMA);
export function validateProviderPortableContext(value) {
    return !containsProviderCredentialMaterial(value) && validate(value);
}
