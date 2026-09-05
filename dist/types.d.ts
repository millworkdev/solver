/**
 * Wire types for the live Millwork API resources. Field names match the backend's wire casing
 * (snake_case), per the arm API contract and
 * the verifier API contract.
 */
export type ArmKind = "model" | "agent" | "skill";
export type ArmStatus = "ready" | "degraded" | "disabled";
export type CostClass = "economy" | "standard" | "premium";
export type DataClass = "public" | "sandbox" | "tenant_internal";
export interface ArmEndpoint {
    url: string;
    auth_ref: string;
}
export interface ArmLifecycle {
    long_running?: boolean;
    cancellable?: boolean;
    max_runtime_s?: number;
}
export interface ArmArtifact {
    content: string;
    version: string;
    editable_regions: string[];
}
/** Full arm record as returned by GET /v1/arms/{armId} and GET /v1/arms. */
export interface Arm {
    arm_id: string;
    kind: ArmKind;
    display_name: string;
    status: ArmStatus;
    capability_tags: string[];
    data_class_grants: DataClass[];
    cost_class?: CostClass;
    provider?: string;
    model_id?: string;
    endpoint?: ArmEndpoint;
    lifecycle?: ArmLifecycle;
    artifact_hash?: string;
    [extra: string]: unknown;
}
/** Body for POST /v1/arms -- one namespace per kind's required fields, per armSchemas.ts. */
export interface ArmWrite {
    kind: ArmKind;
    display_name: string;
    capability_tags: string[];
    data_class_grants: DataClass[];
    cost_class?: CostClass;
    provider?: string;
    model_id?: string;
    credential_ref?: string;
    endpoint?: ArmEndpoint;
    lifecycle?: ArmLifecycle;
    artifact?: ArmArtifact;
}
export interface ArmListFilter {
    kind?: ArmKind;
    status?: ArmStatus;
    cursor?: string;
    limit?: number;
}
export type VerifierKind = "endpoint";
export interface VerifierScoring {
    correctness: "boolean_anchors";
    quality: "scalar_0_1";
}
export interface Verifier {
    verifier_id: string;
    display_name: string;
    version: string;
    kind: VerifierKind;
    endpoint: ArmEndpoint;
    input_data_classes: DataClass[];
    scoring: VerifierScoring;
    hash: string;
    [extra: string]: unknown;
}
export interface VerifierWrite {
    display_name: string;
    version: string;
    kind: VerifierKind;
    endpoint: ArmEndpoint;
    input_data_classes: DataClass[];
    scoring: VerifierScoring;
}
export interface VerifierListFilter {
    cursor?: string;
    limit?: number;
}
export interface ApiKey {
    api_key_id: string;
    key_prefix: string;
    status: "active" | "revoked";
    created_at: string;
    revoked_at: string | null;
    revoked_by?: string | null;
    /** Only present on mint/bootstrap responses -- never returned by list/get. */
    key?: string;
}
export interface Tenant {
    tenant_id: string;
    display_name: string;
    api_key: ApiKey;
}
/**
 * `{ items, nextCursor }` with `.next()` -- never auto-fetches all pages,
 * per the SDK documentation's "no hidden logic" rule. `.next()` is attached by
 * the resource method that produces the page, since it needs to know how to
 * re-issue the request with the next cursor.
 */
export interface Paginated<T> {
    items: T[];
    nextCursor: string | null;
    next(): Promise<Paginated<T>>;
}
/**
 * the public API contract's lifecycle states (Sec4).
 */
export type LifecycleState = "accepted" | "queued" | "running" | "progress" | "completed" | "failed" | "cancelled" | "expired";
interface ExecutionRequestBase {
    task: {
        objective: string;
        inputs_ref?: {
            kind: "url_list" | "url" | "inline_json";
            url?: string;
            json?: Record<string, unknown>;
        };
    };
    policy: {
        data_classes: DataClass[];
        budget: {
            max_cost_usd: number;
            max_runtime_s: number;
        };
        cost_coefficient?: number;
        on_eval?: Array<"gate" | "fallback" | "repair_retry">;
    };
    compose?: "auto";
}
/**
 * Live callers may supply a tenant verifier or omit `verifier_id` to select
 * Millwork API's built-in output-presence baseline (not semantic verification).
 * Echo is the existing platform-proof wire mode: it requires `mode: "echo"`
 * and the API rejects a caller-supplied verifier for that mode.
 */
export type ExecutionRequest = (ExecutionRequestBase & {
    mode?: "live";
    verifier_id?: string;
    routing?: {
        required_arm_id: string;
    };
}) | (ExecutionRequestBase & {
    mode: "echo";
    verifier_id?: never;
    routing?: {
        required_arm_id: string;
    };
});
export type TenantTemplateId = "starter" | "pooled-open-model" | "byok-open-model";
export interface TenantTemplatePlan {
    template_id: TenantTemplateId;
    template_version: string;
    request_preset_id: string;
    issued_at: string;
    expires_at: string;
    digest: string;
    qualification: {
        state: string;
        next_action: {
            type: string;
            detail: string;
        };
    };
    access_lane: "diagnostic" | "millwork_pool" | "byok";
    catalog_row: ModelCatalogEntry | null;
    byok_source: {
        source_id: string;
        auth_scheme: string;
        model_key: string;
        served_variant_id: string;
        certification_id: string;
    } | null;
    blockers: Array<{
        code: string;
        detail: string;
        next_action: {
            type: string;
            detail: string;
        };
    }>;
    alternative_plans: Array<{
        template_id: "byok-open-model";
        template_version: string;
        access_lane: "byok";
        application_supported: boolean;
        next_action: {
            type: string;
            detail: string;
        };
    }>;
    request_policy: {
        mode: "echo" | "live";
        data_classes: DataClass[];
        budget: {
            max_cost_usd: number;
            max_runtime_s: number;
        };
        fallback_policy: "none";
        verifier: "platform.echo" | "platform.output_presence";
    } | null;
    starter_credit: {
        balance_usd: number;
        funded_state: "funded" | "sandbox";
        covers_maximum_spend: boolean;
    };
    maximum_spend_usd: number;
    effects?: Array<{
        id: string;
        description: string;
    }>;
    file_manifest: Array<{
        path: string;
        kind: string;
    }>;
    [extra: string]: unknown;
}
export interface TenantTemplateApplication {
    application_id: string;
    template_id: TenantTemplateId;
    template_version: string;
    /** Approved snapshot preset; absent on older servers, null for legacy rows. */
    request_preset_id?: string | null;
    state: "planned" | "applying" | "consent_pending" | "arm_ready" | "echo_proved" | "live_queued" | "live_running" | "ready" | "action_required" | "failed_safe";
    completed_effects: Array<{
        id: string;
        at: string;
    }>;
    result: {
        execution_id: string;
        href: string;
        model_provenance: ModelAttemptProvenance;
    } | null;
    receipt: {
        receipt_id: string;
        href: string;
    } | null;
    managed_arm_id: string | null;
    echo_execution_id: string | null;
    echo_receipt_id: string | null;
    live_execution_id: string | null;
    selected_model_deployment_id: string | null;
    source_connection_id: string | null;
    consent: {
        handoff_intent_id: string;
        continue_url: string;
        expires_at: string;
        attempt: number;
    } | null;
    live_proof: {
        digest: string;
        issued_at: string;
        expires_at: string;
    } | null;
    next_action: {
        type: string;
        detail: string;
    };
    diagnostics: Record<string, unknown>;
    created_at: string;
    [extra: string]: unknown;
}
export interface Execution {
    execution_id: string;
    status: LifecycleState;
    slices: Array<{
        slice_id: string;
        capability: string;
        status: LifecycleState;
    }>;
    links: {
        status: string;
        events: string;
        receipt: string;
    };
    created_at: string;
    cancelled_by: string | null;
    [extra: string]: unknown;
}
export interface LifecycleEvent {
    event_id: string;
    execution_id: string;
    slice_id?: string;
    type: string;
    state?: LifecycleState;
    reason?: string;
    acted_by?: string | null;
    at: string;
    [extra: string]: unknown;
}
export interface Receipt {
    execution_id: string;
    [extra: string]: unknown;
}
export interface ReceiptListFilter {
    since?: string;
    status?: LifecycleState;
    armId?: string;
}
export type ProposalStatus = "pending" | "approved" | "rejected" | "expired";
export interface Proposal {
    proposal_id: string;
    status: ProposalStatus;
    decided_by?: string | null;
    [extra: string]: unknown;
}
export interface ProposalListFilter {
    status?: ProposalStatus;
    armId?: string;
    cursor?: string;
    limit?: number;
}
export interface Usage {
    period: {
        from: string;
        to: string;
    };
    totals: {
        executions: number;
        slices: number;
        input_tokens: number;
        output_tokens: number;
        calls: number;
        usd: number;
        platform_usd: number;
        passthrough_usd: number;
    };
    by_arm: Array<{
        arm_id: string;
        selected_count: number;
        fallback_count: number;
        input_tokens: number;
        output_tokens: number;
        usd: number;
    }>;
    by_day: Array<{
        date: string;
        executions: number;
        platform_usd: number;
        passthrough_usd: number;
        usd: number;
    }>;
    by_key: Array<{
        api_key_id: string;
        executions: number;
        slices: number;
        input_tokens: number;
        output_tokens: number;
        calls: number;
        usd: number;
        by_day: Array<{
            date: string;
            usd: number;
        }>;
        top_arms: Array<{
            arm_id: string;
            selected_count: number;
        }>;
    }>;
}
export type ComplianceDecisionKind = "proposal_decision" | "execution_cancellation" | "api_key_revocation" | "registry_action";
export interface ComplianceDecisionLogEntry {
    decision_id: string;
    kind: ComplianceDecisionKind;
    action: string;
    resource: {
        type: "proposal" | "execution" | "api_key" | "arm" | "verifier";
        id: string;
    };
    acted_by: string | null;
    at: string;
    proposal?: Proposal;
}
export interface ComplianceExportBundle {
    schema_version: "aud2.v1";
    period: {
        from: string;
        to: string;
    };
    content_policy: {
        receipts: "content_free";
        proposals: "role_scoped_d8b";
    };
    receipts_ndjson: string;
    usage_totals: Usage["totals"];
    decision_log: ComplianceDecisionLogEntry[];
    attestation: {
        algorithm: "sha256";
        digest: string;
    };
}
export type SourceAuthScheme = "api_key" | "oauth2" | "aws_sts_sigv4";
export type SourceProtocolProfile = "openai_responses" | "openai_chat" | "anthropic_messages" | "gemini_generate_content" | "bedrock_converse";
export type NormalizedSourceError = "authentication" | "permission" | "model_not_found" | "rate_limited" | "capacity" | "source_5xx";
/** Discriminated connection scope -- exactly one of the three variants. */
export type SourceScope = {
    kind: "account";
    account_ref: string;
} | {
    kind: "project";
    project_ref: string;
} | {
    kind: "region";
    region: string;
};
export type SourceConnectionTestState = "untested" | "passed" | "failed";
export interface SourceConnection {
    connection_id: string;
    source_id: string;
    display_name: string;
    auth_scheme: SourceAuthScheme;
    /** Opaque broker handle -- masked or redacted for session roles, never a secret. */
    auth_binding_ref: string;
    source_scope: SourceScope;
    status: "active" | "disabled";
    access_lane: "byok" | "millwork_pool";
    credential_owner: "customer";
    commercial_owner: "customer" | "millwork";
    customer_ref: string;
    binding_revision: number;
    tested_binding_revision: number | null;
    test_state: SourceConnectionTestState;
    test_error: NormalizedSourceError | null;
    last_tested_at: string | null;
    rotated_at: string | null;
    revoked_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface CreateSourceConnectionInput {
    display_name: string;
    source_id: string;
    auth_scheme: SourceAuthScheme;
    /** A COMPLETED browser handoff intent -- the SDK never carries a raw secret. */
    handoff_intent_id: string;
    source_scope: SourceScope;
}
/** DELETE answers a revocation acknowledgement, not the full connection wire. */
export interface RevokedSourceConnectionAck {
    connection_id: string;
    status: "active" | "disabled";
    revoked_at: string;
}
export interface VersionedProfileReference {
    id: string;
    version: string;
}
export interface CustomerVisibleSourceProfile {
    source_id: string;
    source_kind: "publisher_direct" | "gateway" | "cloud" | "fixture";
    protocol_profiles: VersionedProfileReference[];
    auth_schemes: VersionedProfileReference[];
    endpoint_policy: {
        https_required: boolean;
        redirects_allowed: boolean;
    };
    /** The listing is customer-owned-only by construction, so the triple is constant. */
    access_lane: "byok";
    credential_owner: "customer";
    commercial_owner: "customer";
}
export interface SourceProfileListing {
    schema_version: string;
    sources: CustomerVisibleSourceProfile[];
}
export type SourceHandoffState = "pending" | "completed" | "failed" | "expired" | "consumed";
export interface SourceCredentialHandoffIntent {
    handoff_intent_id: string;
    source_id: string;
    auth_scheme: SourceAuthScheme;
    state: SourceHandoffState;
    failure_code: "cancelled" | "broker_error" | null;
    expires_at: string;
    completed_at: string | null;
    failed_at: string | null;
    expired_at: string | null;
    consumed_at: string | null;
    created_at: string;
    updated_at: string;
}
/** The 201 start response additionally carries the browser continuation URL. */
export interface StartedSourceCredentialHandoff extends SourceCredentialHandoffIntent {
    continue_url: string;
}
export type ReleaseAssurance = "unknown" | "family_alias" | "source_attested_release" | "exact_artifact";
export interface ModelDeployment {
    model_deployment_id: string;
    connection_id: string;
    source_id: string;
    model_key: string;
    served_variant_id: string;
    upstream_ref: string;
    release_assurance: ReleaseAssurance;
    assurance_evidence_ref: string | null;
    /** Null until dispatch-time resolution -- the API never invents an upstream identity. */
    resolved_upstream_ref: string | null;
    resolution_evidence_ref: string | null;
    protocol_profile: SourceProtocolProfile;
    location: string;
    route: string;
    fallback_policy: "none" | "source_controlled";
    pricing_basis: "source_reported" | "estimated";
    last_tested_at: string;
    status: "listed" | "disabled";
    created_at: string;
    updated_at: string;
}
export type SourceKind = "publisher_direct" | "gateway" | "cloud" | "fixture";
export type ModelLifecycle = "preview" | "active" | "deprecated" | "retired";
export interface ModelDefinition {
    model_key: string;
    publisher_id: string;
    family: string;
    release: string;
    capabilities: string[];
    lifecycle: ModelLifecycle;
    /** License is release-scoped; family-wide claims are not accepted. */
    release_license: {
        identifier: string;
        commercial_use: "allowed" | "restricted" | "unknown";
        evidence_ref: string;
    };
}
export interface ServedModelVariant {
    served_variant_id: string;
    source_id: string;
    model_key: string;
    upstream_ref: string;
    release_assurance: ReleaseAssurance;
    assurance_evidence_ref: string | null;
}
export interface TestedOfferingCertification {
    certification_id: string;
    evidence_schema_version: string;
    standing: "conformant" | "exact_artifact";
    generated_at: string;
    /** Public model and provider-route facts covered by the certification. */
    subject: {
        model_key: string;
        served_variant_id: string;
        source_id: string;
        protocol_profile: SourceProtocolProfile;
        auth_scheme: SourceAuthScheme;
        location: string;
        route: string;
        pricing_basis: "source_reported" | "estimated";
    };
}
export interface TestedSourceOffering {
    served_variant: ServedModelVariant;
    protocol_profile: SourceProtocolProfile;
    auth_scheme: SourceAuthScheme;
    data_classes: DataClass[];
    fallback_policy: "none" | "source_controlled";
    location: string;
    route: string;
    pricing_basis: "source_reported" | "estimated";
    tested_at: string;
    resolved_upstream_ref: string | null;
    resolution_evidence_ref: string | null;
    certification: TestedOfferingCertification;
}
export interface ModelAttemptProvenance {
    schema_version: string;
    requested: {
        model_key: string;
        publisher_id: string;
        family: string;
        release: string;
        served_variant_id: string;
        upstream_ref: string;
    };
    source: {
        source_id: string;
        source_kind: SourceKind;
        connection_id: string;
        access_lane: "byok" | "millwork_pool";
        commercial_owner: "customer" | "millwork";
        auth_scheme: SourceAuthScheme;
    };
    deployment: {
        model_deployment_id: string;
        protocol_profile: SourceProtocolProfile;
        location: string;
        route: string;
        pricing_basis: "source_reported" | "estimated";
        fallback_policy: "none" | "source_controlled";
    };
    /** Additive actual identity; always null on the catalog surface. */
    resolved: {
        upstream_ref: string;
        source_request_id: string | null;
        attestation: "source_response" | "gateway_response";
    } | null;
}
export interface ModelCatalogEntry {
    model: ModelDefinition;
    source: {
        source_id: string;
        source_kind: SourceKind;
    };
    offering: TestedSourceOffering;
    connection: {
        access_lane: "byok";
        commercial_owner: "customer";
        connection_id: string;
    } | {
        access_lane: "millwork_pool";
        commercial_owner: "millwork";
    };
    deployment: Omit<ModelDeployment, "connection_id">;
    provenance: Omit<ModelAttemptProvenance, "source"> & {
        source: (Omit<ModelAttemptProvenance["source"], "access_lane" | "commercial_owner"> & {
            access_lane: "byok";
            commercial_owner: "customer";
        }) | (Omit<ModelAttemptProvenance["source"], "connection_id" | "access_lane" | "commercial_owner"> & {
            access_lane: "millwork_pool";
            commercial_owner: "millwork";
        });
    };
    /** Secretless POST /v1/arms payload for this row. */
    arm_registration_template: {
        kind: "model";
        display_name: string;
        model_deployment_id: string;
        capability_tags: string[];
        data_class_grants: DataClass[];
        cost_class: CostClass;
    };
}
export interface ModelCatalog {
    catalog_policy: "curated_tested_connection_filtered";
    models: ModelCatalogEntry[];
}
export interface ModelDefinitionListing {
    schema_version: string;
    models: ModelDefinition[];
}
export interface ExecutionResult {
    execution_id: string;
    slice_id: string;
    final_text: string;
    model_provenance: ModelAttemptProvenance | null;
    retention_expires_at: string | null;
}
export type VerifierProbeReasonCode = "scheme_rejected" | "dns_resolution_failed" | "private_range_rejected" | "probe_timeout" | "endpoint_unreachable" | "authentication_failed";
/** the public API contract §2.2 VerifierResult. */
export interface VerifierResult {
    is_correct: boolean;
    quality_score: number;
    anchor_results?: Record<string, boolean>;
    named_metrics?: Record<string, number>;
}
export interface VerifierContractCheck {
    validated: boolean;
    verifier_result: VerifierResult | null;
    violation: string | null;
}
export interface VerifierProbeReport {
    outcome: "reachable" | "unreachable";
    reason_code: VerifierProbeReasonCode | null;
    http_status: number | null;
    /** Null when the endpoint was unreachable (no response to check). */
    contract: VerifierContractCheck | null;
    detail: string | null;
    checked_at: string;
}
export interface VerifierTestReport {
    verifier_id: string;
    status: "ready" | "degraded";
    status_reason: string | null;
    probe: VerifierProbeReport;
}
/** POST /v1/verifiers answers a registration OUTCOME, not the full wire --
 * the status is decided by the registration probe, never a default. */
export interface VerifierRegistrationOutcome {
    verifier_id: string;
    hash: string;
    status: "ready" | "degraded";
    status_reason: string | null;
    preflight: VerifierProbeReport;
}
export interface ArmEndpointProbeOutcome {
    reachable: boolean;
    reason_code: VerifierProbeReasonCode | null;
    http_status: number | null;
    detail: string | null;
}
/** POST /v1/arms answers a registration OUTCOME, not the full wire. */
export interface ArmRegistrationOutcome {
    arm_id: string;
    status: ArmStatus;
    status_reason: string | null;
    /** Present only when a reachability probe ran (agent kind). */
    preflight?: ArmEndpointProbeOutcome;
    /** Skill kind only. */
    artifact_hash?: string;
}
export interface VerifierUpdate {
    display_name?: string;
    version?: string;
    endpoint?: ArmEndpoint;
}
export interface EvalSummary {
    window: {
        from: string | null;
        to: string | null;
    };
    pass_rate_trend: Array<{
        day: string;
        verifier_id: string;
        total: number;
        passed: number;
        pass_rate: number;
        mean_quality_score: number;
    }>;
    repair_history: Array<{
        proposal_id: string;
        execution_id: string;
        slice_id: string | null;
        arm_id: string | null;
        parent_artifact_id: string | null;
        parent_score: number | null;
        candidate_score: number | null;
        status: string | null;
        decision: string | null;
        decided_at: string | null;
        created_at: string;
    }>;
}
export interface AccountBalance {
    balance_usd: number;
    top_up_history: Array<{
        at: string;
        amount_usd: number;
        method: "stripe_checkout" | "manual_adjustment" | "refund";
        stripe_event_id: string | null;
        /** Present only when the ledger row recorded a receipt-email outcome. */
        receipt_emailed?: boolean;
    }>;
    credit_activity: Array<{
        at: string;
        amount_usd: number;
        kind: "stripe_checkout" | "credit_grant" | "manual_adjustment" | "refund";
        description: string;
        reference: string | null;
        receipt_emailed?: boolean;
    }>;
    billing_email: string | null;
}
export interface Account {
    tenant_id: string;
    display_name: string;
    quota_tier: string;
    is_demo: boolean;
    quota: {
        executions: {
            limit: number;
            used: number;
            remaining: number;
            reset_at: string;
            retry_after_s: number;
        };
        concurrency: {
            limit: number;
            running: number;
        };
        rate_limit_rpm: number;
    };
    /** Whole-object-or-null: nulled for sessions without billing:view_summary. */
    balance: AccountBalance | null;
    billing: {
        funded_state: "funded" | "sandbox";
        manage_available: boolean;
    } | null;
}
export {};
