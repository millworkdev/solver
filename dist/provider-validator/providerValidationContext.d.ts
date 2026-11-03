export type { IncumbentSourceFacts } from './providerIncumbentCandidates.js';
import type { IncumbentSourceFacts } from './providerIncumbentCandidates.js';
import { PROVIDER_VALIDATOR_VERSION } from './providerValidator.js';
/** Portable conformance inputs. These facts never grant approval or serving authority. */
export interface ProviderPortableValidationContext {
    modelKeys: readonly string[];
    reservedModelPins?: readonly {
        model_key: string;
        lifecycle: 'preview' | 'active';
        route_capabilities: readonly string[];
    }[];
    validator_version?: typeof PROVIDER_VALIDATOR_VERSION;
    incumbentSources?: readonly IncumbentSourceFacts[];
}
export interface ProviderIssuedValidationContext extends ProviderPortableValidationContext {
    validator_version: typeof PROVIDER_VALIDATOR_VERSION;
    incumbentSources: readonly IncumbentSourceFacts[];
}
export declare const PROVIDER_PORTABLE_VALIDATION_CONTEXT_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        modelKeys: {
            uniqueItems: boolean;
            type: string;
            maxItems: number;
            items: object;
        };
        reservedModelPins: {
            type: string;
            maxItems: number;
            items: object;
        };
        validator_version: {
            const: "provider-t0/v1";
        };
        incumbentSources: {
            type: string;
            maxItems: number;
            items: object;
        };
    };
};
export declare const PROVIDER_ISSUED_VALIDATION_CONTEXT_SCHEMA: {
    required: string[];
    type: string;
    additionalProperties: boolean;
    properties: {
        modelKeys: {
            uniqueItems: boolean;
            type: string;
            maxItems: number;
            items: object;
        };
        reservedModelPins: {
            type: string;
            maxItems: number;
            items: object;
        };
        validator_version: {
            const: "provider-t0/v1";
        };
        incumbentSources: {
            type: string;
            maxItems: number;
            items: object;
        };
    };
};
export declare function validateProviderPortableContext(value: unknown): value is ProviderPortableValidationContext;
