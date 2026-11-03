import type { ProviderProfile, ProviderRouteClaim, ValidatorFinding } from './providerValidator.js';
/** Portable, server-issued candidate facts. None of these records certifies a route. */
export interface IncumbentSourceFacts {
    source_id: string;
    source_kind: ProviderProfile['source_kind'];
    protocol_profiles: readonly string[];
    static_route_ids: readonly string[];
    static_routes: readonly {
        model_id: string;
        protocol: string;
        region: string;
    }[];
    candidate_releases: readonly {
        model_key: string;
        model_id: string;
    }[];
    /** Candidate-only model@provider pair; legacy serving upstream_ref remains a model id. */
    gateway_pairs: readonly {
        model_key: string;
        model_id: string;
        upstream_ref: string;
    }[];
}
export declare const INCUMBENT_CANDIDATE_SOURCE_KINDS: {
    readonly openrouter: "gateway";
    readonly fireworks: "cloud";
    readonly aws_bedrock: "cloud";
    readonly anthropic_direct: "publisher_direct";
    readonly openai_direct: "publisher_direct";
    readonly gemini_developer_api: "publisher_direct";
    readonly deepseek_direct: "publisher_direct";
    readonly moonshot_direct: "publisher_direct";
    readonly xai_direct: "publisher_direct";
};
/** T0 policy only: feeds cannot redefine the identity or overwrite the static serving set. */
export declare function incumbentCandidateFindings(profile: ProviderProfile, claim: ProviderRouteClaim, sources: readonly IncumbentSourceFacts[] | undefined, pointer: string): ValidatorFinding[];
