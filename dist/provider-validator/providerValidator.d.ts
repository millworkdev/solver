import { type IncumbentSourceFacts } from './providerIncumbentCandidates.js';
export declare const PROVIDER_CANDIDATE_PROTOCOLS: readonly ["openai_chat", "openai_responses", "anthropic_messages", "gemini_generate_content", "bedrock_converse"];
export declare const PROVIDER_FEED_VERSION: "provider-feed/v1";
export declare const PROVIDER_VALIDATOR_VERSION: "provider-t0/v1";
export interface ProviderProfile {
    legal_entity: string;
    brand: string;
    domain: string;
    source_id: string;
    source_kind: 'publisher_direct' | 'gateway' | 'cloud';
    support_url: string;
    privacy_url: string;
}
export interface ProviderRouteClaim {
    route_id: string;
    model_key: string;
    model_id: string;
    origin: string;
    path: string;
    protocol: (typeof PROVIDER_CANDIDATE_PROTOCOLS)[number];
    region: string;
    data_classes: string[];
    capabilities: string[];
    upstream_ref: string | null;
    fallback: false;
    price: {
        currency: 'USD';
        unit: 'million_tokens';
        input: number;
        output: number;
        revision_sha256: string;
    };
    lifecycle: 'preview' | 'active' | 'deprecated' | 'retired';
    valid_until: string;
    ownership_ref: string;
}
/**
 * A feed entry as the provider sends it. `is_ready` is optional and defaults
 * to true; false asks Millwork to stop serving the route without withdrawing
 * the claim. It is a serving signal, not part of the claim: ingestion strips
 * it before the subject digest, so toggling it never re-stages a revision or
 * voids an approval, and a feed that omits it digests exactly as before.
 */
export type ProviderFeedRoute = ProviderRouteClaim & {
    is_ready?: boolean;
};
export interface ProviderFeed {
    schema_version: typeof PROVIDER_FEED_VERSION;
    provider_source_id: string;
    generated_at: string;
    routes: ProviderFeedRoute[];
}
export interface ProviderFeedValidationContext {
    profile: ProviderProfile;
    modelKeys: readonly string[];
    now?: Date;
    /** Tenant-issued preparation facts only; no certification or serving effect. */
    reservedModelPins?: readonly {
        model_key: string;
        lifecycle: 'preview' | 'active';
        route_capabilities: readonly string[];
    }[];
    /** Server-issued candidate facts; conformance never grants serving authority. */
    incumbentSources?: readonly IncumbentSourceFacts[];
}
export interface ValidatorFinding {
    code: string;
    severity: 'error';
    pointer: string;
    message: string;
}
export interface ProviderValidationReport {
    schema_version: typeof PROVIDER_FEED_VERSION;
    validator_version: typeof PROVIDER_VALIDATOR_VERSION;
    input_sha256: string;
    result: 'validated' | 'nonconformant';
    findings: ValidatorFinding[];
    counts: {
        error: number;
        warning: number;
    };
}
export declare const PROVIDER_PROFILE_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        legal_entity: {
            type: string;
            minLength: number;
            maxLength: number;
        };
        brand: {
            type: string;
            minLength: number;
            maxLength: number;
        };
        domain: {
            type: string;
            pattern: string;
        };
        source_id: {
            type: string;
            pattern: string;
        };
        source_kind: {
            enum: string[];
        };
        support_url: {
            type: string;
            minLength: number;
            maxLength: number;
        };
        privacy_url: {
            type: string;
            minLength: number;
            maxLength: number;
        };
    };
};
export declare const PROVIDER_FEED_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        schema_version: {
            const: "provider-feed/v1";
        };
        provider_source_id: {
            type: string;
            pattern: string;
        };
        generated_at: {
            type: string;
            minLength: number;
            maxLength: number;
        };
        routes: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    route_id: {
                        type: string;
                        pattern: string;
                    };
                    model_key: {
                        type: string;
                        pattern: string;
                    };
                    model_id: {
                        type: string;
                        pattern: string;
                    };
                    origin: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    path: {
                        type: string;
                        pattern: string;
                    };
                    protocol: {
                        enum: string[];
                    };
                    region: {
                        type: string;
                        pattern: string;
                    };
                    data_classes: {
                        type: string;
                        items: {
                            type: string;
                            enum: string[];
                        };
                        uniqueItems: boolean;
                        minItems: number;
                        maxItems: number;
                    };
                    capabilities: {
                        type: string;
                        items: {
                            type: string;
                            enum: string[];
                        };
                        uniqueItems: boolean;
                        minItems: number;
                        maxItems: number;
                    };
                    upstream_ref: {
                        anyOf: ({
                            type: string;
                            pattern: string;
                        } | {
                            type: string;
                        })[];
                    };
                    fallback: {
                        const: boolean;
                    };
                    lifecycle: {
                        enum: string[];
                    };
                    valid_until: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    ownership_ref: {
                        type: string;
                        pattern: string;
                    };
                    is_ready: {
                        type: string;
                    };
                    price: {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            currency: {
                                const: string;
                            };
                            unit: {
                                const: string;
                            };
                            input: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            output: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            revision_sha256: {
                                type: string;
                                pattern: string;
                            };
                        };
                    };
                };
            };
        };
    };
};
export declare const PROVIDER_INCUMBENT_FEED_SCHEMA: {
    properties: {
        routes: {
            items: {
                properties: {
                    protocol: {
                        enum: readonly ["openai_chat", "openai_responses", "anthropic_messages", "gemini_generate_content", "bedrock_converse"];
                    };
                    upstream_ref: {
                        anyOf: ({
                            type: string;
                            pattern: string;
                        } | {
                            type: string;
                        })[];
                    };
                    route_id: {
                        type: string;
                        pattern: string;
                    };
                    model_key: {
                        type: string;
                        pattern: string;
                    };
                    model_id: {
                        type: string;
                        pattern: string;
                    };
                    origin: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    path: {
                        type: string;
                        pattern: string;
                    };
                    region: {
                        type: string;
                        pattern: string;
                    };
                    data_classes: {
                        type: string;
                        items: {
                            type: string;
                            enum: string[];
                        };
                        uniqueItems: boolean;
                        minItems: number;
                        maxItems: number;
                    };
                    capabilities: {
                        type: string;
                        items: {
                            type: string;
                            enum: string[];
                        };
                        uniqueItems: boolean;
                        minItems: number;
                        maxItems: number;
                    };
                    fallback: {
                        const: boolean;
                    };
                    lifecycle: {
                        enum: string[];
                    };
                    valid_until: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    ownership_ref: {
                        type: string;
                        pattern: string;
                    };
                    is_ready: {
                        type: string;
                    };
                    price: {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            currency: {
                                const: string;
                            };
                            unit: {
                                const: string;
                            };
                            input: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            output: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            revision_sha256: {
                                type: string;
                                pattern: string;
                            };
                        };
                    };
                };
                type: string;
                additionalProperties: boolean;
                required: string[];
            };
            type: string;
            minItems: number;
            maxItems: number;
        };
        schema_version: {
            const: "provider-feed/v1";
        };
        provider_source_id: {
            type: string;
            pattern: string;
        };
        generated_at: {
            type: string;
            minLength: number;
            maxLength: number;
        };
    };
    type: string;
    additionalProperties: boolean;
    required: string[];
};
/** Canonical subject bytes pin approval to all fields, including advisory price. */
export declare function providerDigest(value: unknown): string;
export declare function safeProviderOrigin(value: string): boolean;
export declare function validateProviderProfile(value: unknown): value is ProviderProfile;
export declare function validateProviderFeed(value: unknown, context: ProviderFeedValidationContext): ProviderValidationReport;
export interface StatementLine {
    line_id: string;
    request_id: string;
    source_request_id: string;
    tariff_id: string;
    tariff_revision: string;
    tariff_sha256: string;
    input_tokens: number;
    output_tokens: number;
    amount_microusd: number;
    tax_microusd: number;
    adjustment_microusd: number;
}
export interface VerifiedStatementLine extends StatementLine {
    supplier_outcome: 'succeeded' | 'failed';
}
export interface VerifiedSupplierStatement {
    version: 'millwork.supplier-statement.v1';
    supplier_tenant_id: string;
    statement_id: string;
    currency: 'USD';
    period_start: string;
    period_end: string;
    declared_line_count: number;
    totals: {
        input_tokens: number;
        output_tokens: number;
        amount_microusd: number;
        tax_microusd: number;
        adjustment_microusd: number;
    };
    lines: VerifiedStatementLine[];
}
export interface StatementDocument {
    raw_document: string;
    media_type: 'application/json';
    filename?: string;
}
/** Canonical UTF-8 JSON prevents ambiguous duplicate object keys. Digests identify bytes, not signatures. */
export declare function parseSupplierStatement(document: StatementDocument, supplierTenantId: string): {
    errors: string[];
    parsed: VerifiedSupplierStatement | undefined;
    raw_sha256: string;
    parsed_sha256: string | null;
};
/** Caller-supplied, archived facts for offline comparison; never fetched or used to prefill amounts. */
export interface StatementCheckFacts {
    outcome: {
        completed_at: Date | string;
        status: string;
        actual_supplier_microusd: string | number;
    } | null;
    source_request_id: string | null;
    tariff: {
        id: string;
        revision: string;
        sha256: string;
    };
    input_tokens: number | null;
    output_tokens: number | null;
    tax_microusd: number | null;
    effects: Array<{
        dimension: string;
        evidence: {
            correction?: unknown;
        };
        delta_microusd: string | number;
    }>;
}
export declare function reconcileSupplierStatementLine(facts: StatementCheckFacts, line: VerifiedStatementLine, periodStart: string, periodEnd: string): string;
export declare function buildSupplierStatement(statement: VerifiedSupplierStatement): StatementDocument;
export declare function checkSupplierStatement(document: StatementDocument, supplierTenantId: string, facts?: Record<string, StatementCheckFacts>): {
    result: "validated" | "nonconformant";
    errors: string[];
    raw_sha256: string;
    parsed_sha256: string | null;
    lines: {
        line_id: string;
        reason_code: string;
    }[];
    authority: "offline_check_only";
};
