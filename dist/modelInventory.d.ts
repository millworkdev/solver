import type { ArmWrite, DataClass, ModelCatalogEntry, ExecutionRequest, LifecycleState } from "./types.js";
/** Known values aid discovery; future server codes remain available to callers. */
export type ByokBlockerCode = "access_unverified" | "binding_revoked" | "binding_rotated" | "identity_unbound" | "policy_disabled" | "authority_expired" | "price_incomplete" | "spend_bound_missing" | "capability_unverified" | "model_details_unverified" | "data_policy_unknown" | "task_unsupported" | "source_unavailable" | "evidence_expired" | "snapshot_changed" | "plan_changed" | "consent_missing" | "quote_expired" | "invocation_access_unverified" | "source_profile_unproven" | "version_incompatible" | "unknown_paid" | "usage_unreliable" | "bound_exceeded" | (string & {});
export interface ByokBlocker {
    code: ByokBlockerCode;
    actor: string;
    action: string;
    message: string;
    evidence_refs: string[];
}
export interface ByokReadiness {
    disposition: "ready" | "needs_action" | "not_available";
    evaluated_at: string;
    planner_version: "openrouter.inventory/v1" | "openai.inventory/v1" | "gemini.inventory/v1" | "xai.inventory/v1" | "byok.inventory/unsupported";
    policy_revision: number | null;
    blockers: ByokBlocker[];
}
/** Testing is independent of access, route permission, import and arm state. */
export interface ByokTestStanding {
    state: "recorded" | "not_tested" | "unknown";
    last_tested_at: string | null;
    evidence_ref: string | null;
}
export interface ByokTaskEnvelope {
    max_input_tokens: number;
    max_output_tokens: number;
    max_reasoning_tokens?: number;
    max_runtime_s: number;
    data_classes: DataClass[];
}
export interface ByokRouteFacts {
    gemini?: {
        resource_name: string;
        base_model_id: string | null;
        model_version: string | null;
        supported_generation_methods: string[] | null;
    };
    xai?: XaiInventoryDetails;
    invocation_id: string;
    canonical_id: string | null;
    alias_target_id?: string | null;
    display_name: string;
    publisher: string | null;
    input_modalities: string[];
    output_modalities: string[];
    supported_parameters: string[];
    context_length: number | null;
    max_prompt_tokens: number | null;
    max_completion_tokens: number | null;
    provider_name: string | null;
    provider_slug: string | null;
    endpoint_tag: string | null;
    source_status: number | null;
    endpoint_model_id: string | null;
    quantization: string | null;
    region: string | null;
    pricing: Record<string, string | null>;
    pricing_conditions: unknown;
    reasoning: {
        mandatory: boolean | null;
        supported: boolean | null;
        supports_max_tokens?: boolean | null;
    };
    data_policy: {
        data_collection: "allow" | "deny" | null;
    };
    evidence: {
        observed_at: string;
        source_url: string;
        digest: string;
    };
    source_metadata?: {
        kind: "openai_model";
        created: number | null;
        owned_by: string | null;
        shutdown_date: string | null;
    };
}
export interface ByokInventorySnapshot {
    id: string;
    connection_id: string;
    source_id: string;
    binding_revision: number;
    scope: "account_observed";
    completeness: "complete" | "partial" | "importing" | "failed";
    as_of: string;
    observed_count: number;
    failure_code: string | null;
}
export interface ByokInventoryRoute {
    item_id: string;
    route_id: string;
    observation_revision: string;
    snapshot_id: string;
    invocation_id: string;
    model_group_key: string;
    display_name: string;
    publisher: string | null;
    source_id: string;
    connection_id: string;
    connection_name: string;
    protocol_profile: "openai_chat" | "gemini_generate_content" | null;
    location: string | null;
    commercial_owner: "customer";
    facts: ByokRouteFacts;
    testing: ByokTestStanding;
    readiness: ByokReadiness;
    authorization: ByokAuthorityWire | null;
    added: {
        arm_ids: string[];
        model_deployment_id: string | null;
        registrations: Array<{
            arm_id: string;
            authority_id: string;
            model_deployment_id: string;
        }>;
    };
}
export interface ByokInventoryItem {
    item_id: string;
    invocation_id: string;
    source_id: string;
    connection_id: string;
    model_group_key: string;
    routes: ByokInventoryRoute[];
}
export interface ByokInventoryItemDetail extends ByokInventoryItem {
    prior_observations: Array<{
        route_id: string;
        observation_revision: string;
        snapshot_id: string;
        observed_at: string;
        facts: ByokRouteFacts;
    }>;
    prior_observation_total: number;
    prior_observations_complete: boolean;
}
/** A composition does not turn account observations into tested catalog rows. */
export interface ByokCatalogGroup {
    model_group_key: string;
    model: {
        model_key: string;
        display_name: string;
        publisher_id: string | null;
        capability_tags: string[];
        lifecycle: string | null;
    };
    route_count: number;
    routes: Array<{
        kind: "tested";
        catalog: ModelCatalogEntry;
    } | {
        kind: "account_inventory";
        inventory: ByokInventoryRoute;
    }>;
}
export interface ByokInventoryPage {
    snapshot: ByokInventorySnapshot | null;
    snapshots: ByokInventorySnapshot[];
    /** Item counts; never substitute these for route or composed-model totals. */
    counts: {
        listed: number | null;
        can_add_now: number | null;
        added: number | null;
    };
    totals: {
        route_total: number | null;
        model_group_total: number | null;
        completeness: "complete" | "partial" | "not_imported";
    };
    items: ByokInventoryItem[];
    routes: ByokInventoryRoute[];
    models?: ByokCatalogGroup[];
    catalog_routes?: ByokCatalogGroup["routes"];
    view: "routes" | "models";
    snapshot_digest: string;
    next_cursor: string | null;
}
export interface ByokInventoryFilter {
    access_lane?: "byok" | "millwork_pool";
    connection_id?: string;
    source_id?: string;
    q?: string;
    readiness?: ByokReadiness["disposition"];
    publisher_id?: string;
    model_group_key?: string;
    cursor?: string;
    limit?: number;
    view?: "routes" | "models";
    include_tested?: boolean;
    snapshot_digest?: string;
}
export interface ByokInventoryFacets {
    snapshot_digest: string;
    connections: Array<{
        connection_id: string;
        source_id: string;
        display_name: string;
        route_count: number;
    }>;
    publishers: Array<{
        publisher_id: string;
        route_count: number;
    }>;
    readiness: Array<{
        disposition: ByokReadiness["disposition"];
        route_count: number;
    }>;
    totals: ByokInventoryPage["totals"];
}
export interface ByokImportWire {
    last_good_snapshot_id: string | null;
    last_good_at: string | null;
    import_id: string;
    connection_id: string;
    state: ByokInventorySnapshot["completeness"];
    started_at: string;
    completed_at: string | null;
    observed_count: number;
    failure_code: string | null;
}
export interface ByokPlanRequest {
    item_id: string;
    route_id: string;
    observation_revision: string;
    purpose: "add" | "execute";
    task_envelope?: ByokTaskEnvelope;
    task?: {
        objective: string;
    };
    authority_id?: string;
}
export interface ByokPreparedRequest {
    model: string;
    stream: false;
    max_tokens: number;
    provider: {
        only: string[];
        order: string[];
        allow_fallbacks: false;
        require_parameters: true;
        data_collection: "deny";
        max_price: Record<string, number>;
    };
    reasoning?: {
        effort: "none";
    } | {
        enabled: true;
    } | {
        max_tokens: number;
    };
    usage: {
        include: true;
    };
}
export type ByokUsageField = "prompt_tokens" | "completion_tokens" | "uncached_prompt_tokens" | "visible_completion_tokens" | "completion_tokens_details.reasoning_tokens" | "prompt_tokens_details.cached_tokens" | "prompt_tokens_details.cache_write_tokens" | "request";
export interface ByokClassEvidence {
    version: "openrouter.classes/v1";
    revision: string;
    proof_digest: string;
    evidence_refs: string[];
    expires_at: string;
    resolved_model_ids: string[];
    expected_provider: string;
    reasoning_mode: "disabled" | "shared_completion" | "independent";
    reasoning_maximum_tokens: number;
    meter_limits: Array<{
        meter: string;
        usage_field: ByokUsageField;
        maximum_volume: number;
    }>;
    partitions: Array<{
        partition: string;
        usage_fields: ByokUsageField[];
        maximum_volume: number;
    }>;
}
export interface ByokBound {
    provider_maximum_microusd: number;
    input_volume_tokens: number;
    output_volume_tokens: number;
    meters: Array<{
        meter: string;
        maximum_volume: number;
        rate_usd: string;
        maximum_microusd: number;
    }>;
    rate_digest: string;
    source_contract_revision: string;
    assumptions: string[];
    class_evidence?: ByokClassEvidence;
}
export interface ByokPlanWire {
    purpose: "add" | "execute";
    item_id: string;
    route_id: string;
    observation_revision: string;
    connection_id: string;
    source_id: string;
    binding_revision: number;
    invocation_id: string;
    readiness: ByokReadiness;
    task_envelope: ByokTaskEnvelope | null;
    prepared_request: ByokPreparedRequest | null;
    bound: ByokBound | null;
    plan_digest: string | null;
    plan_token: string | null;
    /** Last time these reviewed inputs may be confirmed; not permission expiry. */
    confirmation_expires_at: string | null;
    permission_expires_at: string | null;
    evaluated_at: string;
    testing: ByokTestStanding;
}
export interface ByokConfirmRequest {
    plan_token: string;
    plan_digest: string;
    original_inputs: ByokPlanRequest;
}
/** Inventory arms bind the issued permission; deployment is projected when the saved arm is read. */
export type ByokInventoryArmTemplate = Pick<ArmWrite, "display_name" | "capability_tags" | "data_class_grants" | "cost_class"> & {
    kind: "model";
    route_authority_id: string;
    model_deployment_id?: never;
};
export interface ByokAuthorityWire {
    policy_revision: number;
    planner_version: ByokReadiness["planner_version"];
    /** Applicable test standing at issuance, independent of current permission state. */
    testing: ByokTestStanding;
    authority_id: string;
    authority_revision: number;
    model_deployment_id: string;
    item_id: string;
    route_id: string;
    observation_revision: string;
    connection_id: string;
    source_id: string;
    binding_revision: number;
    plan_digest: string;
    issued_at: string;
    expires_at: string;
    state: "authorized" | "expired" | "revoked";
    task_envelope: ByokTaskEnvelope;
    prepared_request: ByokPreparedRequest;
    bound: ByokBound;
    /** Submit this server-issued template unchanged; do not derive it from listing IDs. */
    arm_registration_template: ByokInventoryArmTemplate;
}
export interface ByokAuthorityOperation {
    operation_key: string;
    state: "confirmed" | "refused";
    response_status: number;
    authority: ByokAuthorityWire | null;
    blockers: ByokBlocker[];
}
export interface ByokQuoteRequest extends ByokConfirmRequest {
    authority_id: string;
    provider_usage_budget_usd: number;
}
export interface ByokQuoteWire {
    schema_version: "byok-inventory-quote/v1";
    authority_id: string;
    model_deployment_id: string;
    plan_digest: string;
    provider_maximum_usd: number;
    provider_usage_budget_usd: number;
    millwork_fee_usd: number;
    maximum_combined_usd: number;
    price_approval_sha256: string;
    expires_at: string;
    provider_invoice_authoritative: true;
    bound: ByokBound;
}
export interface ByokInventoryApproval {
    authority_id: string;
    plan_token: string;
    plan_digest: string;
    original_inputs: ByokPlanRequest;
    provider_usage_budget_usd: number;
    price_approval_sha256: string;
}
/** Unknown paid exposure is retained separately from any reported partial cost. */
export interface ByokInventoryReceipt {
    /** Immutable permission and source controls retained for this invocation. */
    authority: ByokAuthorityWire;
    requested_invocation_id: string;
    prepared_request: ByokPreparedRequest;
    testing: ByokTestStanding;
    approved_provider_maximum_microusd: number;
    approved_provider_budget_microusd: number;
    millwork_fee_microusd: number;
    source_request_id: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    raw_usage_digest: string | null;
    meter_usage?: Array<{
        meter: string;
        volume: number | null;
    }>;
    authority_id: string;
    authority_revision: number;
    model_deployment_id: string;
    route_id: string;
    observation_revision: string;
    plan_digest: string;
    outcome: "not_sent" | "known_paid" | "rejected_paid" | "unknown_paid";
    provider_cost_microusd: number | null;
    reported_cost_microusd: number | null;
    unresolved_exposure_microusd: number;
    bound: ByokBound;
    blockers: ByokBlocker[];
    reported_model_id: string | null;
    reported_provider: string | null;
}
/** Exact selected-check wire; metadata/plan reads grant no paid authority. */
export interface ByokCheckSelection {
    item_id: string;
    route_id: string;
    observation_revision: string;
    snapshot_id: string;
    authority_id: string | null;
    arm_id: string | null;
}
export interface ByokBatchRequest {
    batch_id?: string;
    expected_revision?: number;
    connection_id: string;
    binding_revision: number;
    snapshot_digest: string;
    filter: Omit<ByokInventoryFilter, "cursor" | "snapshot_digest">;
    selected: ByokCheckSelection[];
    task: {
        objective: string;
    };
}
export interface ByokBatchPlannedItem {
    selection: ByokCheckSelection;
    plan: ByokPlanWire | null;
    quote: ByokQuoteWire | null;
    execution: ExecutionRequest | null;
    blockers: ByokBlocker[];
}
export interface ByokBatchPlan {
    version: "byok-selected-checks/v1";
    request: ByokBatchRequest;
    items: ByokBatchPlannedItem[];
    counts: {
        selected: number;
        eligible: number;
        blocked: number;
        approved_real_checks: number;
    };
    limits: {
        items: 20;
        in_flight: 1;
        attempts: 1;
    };
    ordinary_fee_cents: number;
    provider_maximum_microusd: number;
    millwork_maximum_cents: number;
    confirmation_expires_at: string;
    expires_at: string;
    plan_digest: string;
    plan_token: string;
    provider_invoice_authoritative: true;
}
export type ByokCheckState = "pending" | "blocked" | "accepted" | "completed" | "failed" | "cancelled" | "unknown_paid";
export interface ByokBatchItemWire {
    check_item_id: string;
    child_operation_key: string;
    ordinal: number;
    selection: ByokCheckSelection;
    state: ByokCheckState;
    revision: number;
    approval_revision: number;
    execution_id: string | null;
    execution_status: LifecycleState | null;
    blockers: ByokBlocker[];
    provider_maximum_microusd: number;
    provider_known_microusd: number;
    provider_unresolved_microusd: number;
    millwork_fee_cents: number;
    receipt: string | null;
    reconciliation: {
        evidence_ref: string;
        evidence_sha256: string;
        actor: string;
        recorded_at: string;
    } | null;
}
export interface ByokBatchWire {
    batch_id: string;
    version: "byok-selected-checks/v1";
    connection_id: string;
    binding_revision: number;
    state: "active" | "paused" | "completed" | "cancelled";
    revision: number;
    approval_revision: number;
    approvals: Array<{
        revision: number;
        plan_digest: string;
        confirmed_at: string;
        expires_at: string;
        millwork_maximum_cents: number;
    }>;
    approval_count: number;
    approvals_complete: boolean;
    plan_digest: string;
    expires_at: string;
    created_at: string;
    limits: {
        items: 20;
        in_flight: 1;
        attempts: 1;
    };
    problem: {
        type: string;
        title: string;
        status: number;
        instance: string;
        detail?: string;
        blockers?: ByokBlocker[];
        [extension: string]: unknown;
    } | null;
    counts: Record<ByokCheckState, number>;
    provider_approved_microusd: number;
    provider_known_microusd: number | null;
    provider_known_microusd_exact: string;
    provider_unresolved_microusd: number;
    provider_unstarted_microusd: number;
    millwork_fee_cents: number;
    items: ByokBatchItemWire[];
}
export interface ByokBatchMutation {
    expected_revision: number;
    acknowledged_unknown_execution_ids?: string[];
    plan?: ByokBatchPlan;
}
export interface XaiInventoryDetails {
    reader_version: "xai.inventory/v1";
    kind: "language" | "unknown";
    detail_complete: boolean;
    modalities_complete: boolean;
    aliases: string[];
    alias_targets: string[];
    version: string | null;
    fingerprint: string | null;
    created: number | null;
    reasoning_efforts: string[] | null;
    default_reasoning_effort: string | null;
    rate_unit: "usd_cents_per_100_million_tokens";
    token_rates: Record<string, number | null>;
    search_price: number | null;
    search_rate_unit: "usd_cents_per_100_million_searches";
    long_context_threshold: number | null;
}
