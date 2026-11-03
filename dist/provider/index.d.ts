import { buildSupplierStatement, checkSupplierStatement, parseSupplierStatement, type StatementDocument } from '#provider-feed-validator';
export { verifyProviderWebhook } from './webhookVerifier.js';
export type { ProviderWebhookNotification, ProviderWebhookVerificationInput, ProviderWebhookVerification } from './webhookVerifier.js';
export { buildSupplierStatement, checkSupplierStatement, parseSupplierStatement };
export type { StatementDocument, VerifiedSupplierStatement, VerifiedStatementLine, StatementCheckFacts } from '#provider-feed-validator';
export interface SupplierStatementVerification {
    version: string;
    supplier_tenant_id: string;
    statement_id: string;
    preflight_id: string;
    raw_sha256: string;
    parsed_sha256: string | null;
    credential_kind: 'tenant_api_key' | 'scoped_key';
    status: 'verified' | 'exception' | 'rejected';
    errors: string[];
    lines: Array<{
        line_id: string;
        request_id: string | null;
        outcome: 'verified' | 'exception' | 'duplicate';
        reason_code: string;
        facts_revision: string | null;
    }>;
}
export interface RecordedSupplierStatement extends SupplierStatementVerification {
    verification_id: string;
    received_at: string;
    idempotent_replay?: boolean;
}
import { SolverApiError } from "../errors.js";
import { type SolverClientOptions } from "../httpClient.js";
import { validateProviderFeed, type ProviderFeed, type ProviderProfile, type ProviderValidationReport, type ValidatorFinding } from "#provider-feed-validator";
export { validateProviderFeed, validateProviderProfile, PROVIDER_FEED_SCHEMA, PROVIDER_INCUMBENT_FEED_SCHEMA, PROVIDER_PROFILE_SCHEMA, PROVIDER_FEED_VERSION, PROVIDER_VALIDATOR_VERSION, providerDigest } from "#provider-feed-validator";
export type { ProviderFeed, ProviderFeedRoute, ProviderProfile, ProviderRouteClaim, ProviderValidationReport, ValidatorFinding } from "#provider-feed-validator";
import { type ProviderIssuedValidationContext } from "#provider-validation-context";
export { validateProviderPortableContext, PROVIDER_PORTABLE_VALIDATION_CONTEXT_SCHEMA, PROVIDER_ISSUED_VALIDATION_CONTEXT_SCHEMA } from "#provider-validation-context";
export type { ProviderIssuedValidationContext, ProviderPortableValidationContext, IncumbentSourceFacts } from "#provider-validation-context";
export type ProviderFeedValidationContext = Parameters<typeof validateProviderFeed>[1];
export type ProviderValidationInput = ProviderFeedValidationContext & import("#provider-validation-context").ProviderPortableValidationContext;
export declare function checkProviderFeed(feed: unknown, context: ProviderValidationInput): ProviderValidationReport;
export interface ProviderRouteExposure {
    catalog: "hidden" | "canary_only" | "visible" | "unobserved";
    execution: "closed" | "admission_open" | "unobserved";
    degraded: boolean;
    label: "In manifest" | "Catalog visible" | "Canary only" | "Admission open" | "Exposure unobserved";
}
export type ProviderApplicationStatus = "submitted" | "approved" | "rejected";
export type ProviderRouteState = "validated" | "nonconformant" | "live_verified" | "quarantined" | "eligible_for_decision" | "route_approved" | "byok_listed" | "deprecated" | "retired";
export type ProviderRouteLifecycleReason = "absent_from_feed" | "not_ready" | "claim_expired" | "t2_expired" | "domain_expired" | "drift";
export type ProviderRouteSuspension = {
    by: "operator";
    reason: "operator_suspended";
} | {
    by: "system";
    reason: ProviderRouteLifecycleReason;
};
export interface ProviderLifecycleOutcome {
    held: "breaker_tripped" | "breaker_held" | null;
    demoted: Array<{
        route_id: string;
        revision_id: string;
        reason: ProviderRouteLifecycleReason;
    }>;
    restored: Array<{
        route_id: string;
        revision_id: string;
    }>;
    suspended_routes: number;
    restored_routes: number;
}
export interface ProviderProfileView {
    tenant_id: string;
    profile: ProviderProfile;
    profile_revision: number;
    feed_etag: string;
    status: ProviderApplicationStatus;
    reason_code?: string | null;
    listed: false;
    listing_scope: "customer_exposure";
    next_actor: "provider" | "operator" | "none";
    next_action: string;
    routes: Array<{
        route_id: string;
        revision_id: string;
        state: ProviderRouteState;
        claim: import("#provider-feed-validator").ProviderRouteClaim;
        approval_state: ProviderRouteState;
        activation_scope: "loaded_manifest" | null;
        exposure?: ProviderRouteExposure | null;
        suspension: ProviderRouteSuspension | null;
        next_actor?: "operator" | "provider";
    }>;
}
export interface ProviderFeedModelResult {
    index: number;
    route_id: string | null;
    model_key: string | null;
    outcome: "staged_new" | "restaged_material_change" | "restaged_after_withdrawal" | "unchanged" | "rejected" | "not_staged";
    revision_id: string | null;
    previous_revision_id: string | null;
    previous_state: string | null;
    approval_voided: boolean;
    findings: ValidatorFinding[];
}
export interface ProviderFeedSubmission {
    snapshot_id: string;
    validation: ProviderValidationReport;
    feed_etag: string;
    revision_ids: string[];
    models: ProviderFeedModelResult[];
    absent_route_ids: string[];
    lifecycle?: ProviderLifecycleOutcome;
    listed: false;
    next_actor: "provider" | "operator";
    next_action: "authorize_exact_revision_probe" | "correct_validation_findings";
}
export interface ProviderFeedSource {
    feed_url: string;
    enabled: boolean;
    pull_interval_seconds: number;
    next_pull_at: string;
    updated_at?: string;
    listed?: false;
}
export interface ProviderFeedPullReport {
    report_version: "provider-feed-pull/v1";
    pull_id: string | null;
    tenant_id: string;
    trigger: "scheduled" | "provider" | "operator";
    dry_run: boolean;
    result: "completed" | "nonconformant" | "inconclusive";
    fetch: {
        outcome: "fetched" | "timeout" | "network" | "http_status" | "egress_refused" | "malformed_feed" | "oversized_feed" | "deadline" | "cancelled" | "internal_error";
        attempts: number;
        http_status: number | null;
        input_sha256: string | null;
    };
    schema_version: "provider-feed/v1";
    validator_version: "provider-t0/v1";
    snapshot_id: string | null;
    envelope_findings: ValidatorFinding[];
    models: ProviderFeedModelResult[];
    absent_route_ids: string[];
    discarded: "provider_changed" | "source_changed" | "feed_changed" | null;
    counts: {
        entries: number;
        staged_new: number;
        restaged: number;
        unchanged: number;
        rejected: number;
        not_staged: number;
    };
    started_at: string;
    completed_at: string;
    lifecycle?: ProviderLifecycleOutcome;
}
export interface ProviderPullReport extends ProviderFeedPullReport {
    listed: false;
}
export interface ProviderPullHistoryEntry {
    pull_id: string;
    trigger: ProviderFeedPullReport["trigger"];
    status: "running" | "abandoned" | ProviderFeedPullReport["result"];
    snapshot_id: string | null;
    report: ProviderFeedPullReport | null;
    report_sha256: string | null;
    started_at: string;
    completed_at: string | null;
}
export type ProviderWebhookEvent = "provider.application.updated" | "provider.feed.validated" | "provider.route.updated";
export interface ProviderWebhook {
    webhook_id: string;
    url: string;
    events: ProviderWebhookEvent[];
    status: "active" | "disabled";
    secret_version: number;
    created_at: string;
    updated_at: string;
}
export interface ProviderWebhookCreated extends ProviderWebhook {
    signing_secret: string;
}
export interface ProviderWebhookDelivery {
    delivery_id: string;
    webhook_id: string;
    event: ProviderWebhookEvent;
    status: "pending" | "delivered" | "dead_lettered";
    attempts: number;
    next_attempt_at: string | null;
    last_attempt_at: string | null;
    response_status: number | null;
    failure_reason: string | null;
    created_at: string;
}
export interface ProviderNextStep {
    actor: "provider" | "operator" | "none";
    action: string;
}
export interface ProviderWorkspaceRoute {
    route_id: string;
    revision_id: string;
    revision: number;
    subject_sha256: string;
    state: ProviderRouteState;
    approval_state: ProviderRouteState;
    activation_scope: "loaded_manifest" | null;
    exposure?: ProviderRouteExposure | null;
    suspension: ProviderRouteSuspension | null;
    lifecycle_reason: string | null;
    claim: import("#provider-feed-validator").ProviderRouteClaim;
    created_at: string;
    t2_valid_until: string | null;
    expired: boolean;
    previous: {
        revision: number;
        claim: import("#provider-feed-validator").ProviderRouteClaim;
    } | null;
    t1?: {
        outcome: "pass" | "fail" | "inconclusive";
        reason_codes: string[];
    } | null;
    changed_fields: string[];
    probe: {
        status: "none" | "active" | "expired" | "revoked" | "closed";
        expires_at?: string;
    };
    serving_provider: string;
    upstream: {
        ref: string;
        fallback: false;
    } | null;
    next: ProviderNextStep;
}
export interface ProviderWorkspaceView {
    feed_etag: string;
    tenant_id: string;
    listed: false;
    machine_access: {
        enabled: boolean;
    };
    organization: {
        profile: ProviderProfile;
        profile_revision: number;
        status: ProviderApplicationStatus;
        reason_code?: string | null;
        approved_source_id: string | null;
    };
    terms: {
        accepted_version: string;
        accepted_at: string;
        current_version: string;
        current: boolean;
        offer: {
            document_id: string;
            title: string;
            version_id: string;
            display_label: string;
            updated_at: string;
            source_sha256: string;
            offer_id: string;
            content_markdown: string;
            published_url: string;
        } | null;
        offer_status: "available" | "unavailable";
        accepted_offer_id: string | null;
        can_accept: boolean;
        acceptance_hold: "organization_identity_changed" | null;
        responsible_roles: ["owner", "admin"];
        history: Array<{
            version_id: string;
            offer_id: string | null;
            source_sha256: string | null;
            accepted_at: string;
            accepted_by: string;
            legal_entity_name?: string;
            legacy?: boolean;
        }>;
    };
    domain: {
        domain: string;
        verified_at: string | null;
        valid_until: string | null;
        current: boolean;
    };
    next: ProviderNextStep;
    routes: ProviderWorkspaceRoute[];
    latest_feed: {
        snapshot_id: string;
        created_at: string;
        validation: ProviderValidationReport;
    } | null;
    model_keys: string[];
}
export interface ProviderFeedOnlineCheck {
    validation: ProviderValidationReport;
    listed: false;
    next: ProviderNextStep;
}
export interface ProviderDeprecation {
    route_id: string;
    revision_id: string;
    revision: number;
    state: "deprecated";
    listed: false;
    lifecycle?: ProviderLifecycleOutcome;
    next: ProviderNextStep;
}
export declare const PROVIDER_SECRET_REPLAY_RECOVERY = "List the existing keys, or revoke the key whose secret was lost, then explicitly mint a new key. The old secret cannot be recovered; do not repeat the creation request.";
/** A withheld once-only secret is a recovery task, never a retryable creation. */
export declare class ProviderSecretReplayUnavailableError extends SolverApiError {
    readonly code: "idempotent_replay_secret_unavailable";
    readonly recovery: "list_or_revoke_then_mint_new_key";
    constructor(error: SolverApiError);
}
export interface SupplierSupplyGrant {
    offering_id: string;
    revision: number;
    grant_sha256: string;
    supplier_legal_entity: string;
    state: string;
}
export interface SupplierSupplyRequest {
    request_id: string;
    offering_id: string;
    state: string;
    accepted_supplier_microusd: string | null;
    current_net_payable_microusd: string | null;
}
export interface SupplierSupplyStatement {
    statement_id: string;
    digest: string;
    source_verification: string;
    status: string;
}
export interface SupplierSupplyStatementDetail extends SupplierSupplyStatement {
    lines: Array<{
        line_id: string;
        request_id: string | null;
        original_match_status: string;
    }>;
}
/** Provider metadata only. No approval, paid probe, custody, or listing mutation is exposed. */
export declare class ProviderClient {
    private readonly http;
    private readonly singleAttemptHttp;
    constructor(options: SolverClientOptions);
    private request;
    workspace(): Promise<ProviderWorkspaceView>;
    /** The archived supply view. Same bytes as the workspace reads; no approval or commit. */
    supplyGrants(): Promise<{
        grants: SupplierSupplyGrant[];
    }>;
    supplyRequests(cursor?: string): Promise<{
        requests: SupplierSupplyRequest[];
        next_cursor: string | null;
    }>;
    supplyRequest(requestId: string): Promise<SupplierSupplyRequest>;
    supplyStatements(): Promise<{
        statements: SupplierSupplyStatement[];
    }>;
    supplyStatement(statementId: string): Promise<SupplierSupplyStatementDetail>;
    statementPreflight(document: StatementDocument): Promise<SupplierStatementVerification>;
    statementCommit(document: StatementDocument, preflightId: string, approvalId?: string): Promise<RecordedSupplierStatement>;
    statementStatus(statementId: string): Promise<RecordedSupplierStatement>;
    checkFeedOnline(feed: ProviderFeed, ifMatch: string): Promise<ProviderFeedOnlineCheck>;
    routeLifecycle(routeId: string, input: {
        revision_id: string;
        subject_sha256: string;
        lifecycle: "deprecated";
    }, ifMatch: string): Promise<ProviderDeprecation>;
    profile(): Promise<ProviderProfileView>;
    validationContext(): Promise<ProviderIssuedValidationContext>;
    updateProfile(profile: ProviderProfile, profileRevision: number): Promise<{
        profile_revision: number;
        status: "submitted";
        listed: false;
    }>;
    domainChallenge(): Promise<{
        challenge_id: string;
        domain: string;
        expires_at: string;
        txt_name: string;
        txt_value: string;
        well_known_path: string;
        well_known_value: string;
    }>;
    verifyDomain(challengeId: string): Promise<{
        verified: boolean;
    }>;
    submitFeed(feed: ProviderFeed, ifMatch: string): Promise<ProviderFeedSubmission>;
    feedSource(): Promise<ProviderFeedSource>;
    configureFeedSource(body: {
        feed_url: string;
        enabled?: boolean;
        pull_interval_seconds?: number;
    }): Promise<ProviderFeedSource>;
    refreshFeed(ifMatch: string, dryRun?: boolean): Promise<ProviderPullReport>;
    feedPulls(): Promise<{
        pulls: ProviderPullHistoryEntry[];
    }>;
    webhooks(): Promise<{
        webhooks: ProviderWebhook[];
    }>;
    createWebhook(url: string, events: ProviderWebhookEvent[]): Promise<ProviderWebhookCreated>;
    setWebhookStatus(webhookId: string, status: "active" | "disabled"): Promise<ProviderWebhook>;
    rotateWebhookSecret(webhookId: string): Promise<ProviderWebhookCreated>;
    webhookDeliveries(webhookId: string, status?: ProviderWebhookDelivery["status"]): Promise<{
        deliveries: ProviderWebhookDelivery[];
    }>;
    replayWebhookDelivery(deliveryId: string): Promise<ProviderWebhookDelivery>;
}
