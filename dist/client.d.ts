import { HttpClient, type SolverClientOptions } from "./httpClient.js";
import { AccountResource } from "./resources/account.js";
import { ApiKeysResource } from "./resources/apiKeys.js";
import { ArmsResource } from "./resources/arms.js";
import { EvalSummaryResource } from "./resources/evalSummary.js";
import { ExecutionsResource } from "./resources/executions.js";
import { ModelCatalogResource } from "./resources/modelCatalog.js";
import { ModelDeploymentsResource } from "./resources/modelDeployments.js";
import { ModelSourceProfilesResource } from "./resources/modelSourceProfiles.js";
import { ProposalsResource } from "./resources/proposals.js";
import { ReceiptsResource } from "./resources/receipts.js";
import { SourceConnectionsResource } from "./resources/sourceConnections.js";
import { SourceCredentialHandoffsResource } from "./resources/sourceCredentialHandoffs.js";
import { UsageResource } from "./resources/usage.js";
import { ComplianceExportsResource } from "./resources/complianceExports.js";
import { VerifiersResource } from "./resources/verifiers.js";
import { TenantTemplatesResource } from "./resources/tenantTemplates.js";
import type { VerifierConnectionView } from "./types.js";
/**
 * Connection client for hidden `/v1` verifier-connection routes. The type name
 * must not end in Resource so published wrapper discovery stays unchanged.
 * This is not a public SDK surface.
 */
declare class UnpublishedVerifierConnection {
    private readonly http;
    constructor(http: HttpClient);
    createIntent(verifierId: string, stopChoice: {
        kind: "no_expiration";
    } | {
        kind: "preset_days";
        days: 30 | 90 | 180 | 365;
    } | {
        kind: "calendar_date";
        date: string;
        time_zone: string;
    }, opts?: {
        idempotencyKey?: string;
    }): Promise<{
        continue_url: string;
        intake_origin: string;
        intent_id: string;
        origin: string;
        expires_at: string;
        stop_choice?: unknown;
    }>;
    inspect(verifierId: string, opts?: {
        operationKey?: string;
    }): Promise<VerifierConnectionView>;
    /**
     * `operationKey` names the lifecycle operation and is sent in the body, so
     * a resume keeps the original operation while `idempotencyKey` gives this
     * HTTP request its own replay context. Repeating the original request key
     * would only replay its recorded response.
     */
    testAndPromote(verifierId: string, input: {
        handle: string;
        captured_generation: number;
    }, opts?: {
        idempotencyKey?: string;
        operationKey?: string;
    }): Promise<{
        generation: number;
        handle: string;
    }>;
    revoke(verifierId: string, opts?: {
        idempotencyKey?: string;
        operationKey?: string;
    }): Promise<{
        generation: number;
    }>;
}
/**
 * `new Solver({ apiKey, baseUrl, maxRetries, retryBackoffMs })`, per
 * the SDK documentation's "Client construction". One namespace per core
 * object. Every resource is a thin wrapper over its live v1 endpoint; no
 * ranking, caching, or policy behavior runs on the client.
 *
 * The model-access chain reads left to right:
 * `modelSourceProfiles` (what can be connected) ->
 * `sourceCredentialHandoffs` (browser handoff; no secret ever transits the
 * SDK) -> `sourceConnections` (the customer-owned binding) -> `modelDeployments`
 * (certification-backed supply) -> `modelCatalog` (usable intersection) ->
 * `arms.create({ model_deployment_id })` -> `executions` -> `receipts`.
 */
export declare class Solver {
    readonly arms: ArmsResource;
    readonly verifiers: VerifiersResource;
    readonly verifierConnection: UnpublishedVerifierConnection;
    readonly apiKeys: ApiKeysResource;
    readonly executions: ExecutionsResource;
    readonly receipts: ReceiptsResource;
    readonly proposals: ProposalsResource;
    readonly usage: UsageResource;
    readonly complianceExports: ComplianceExportsResource;
    readonly modelSourceProfiles: ModelSourceProfilesResource;
    readonly sourceCredentialHandoffs: SourceCredentialHandoffsResource;
    readonly sourceConnections: SourceConnectionsResource;
    readonly modelDeployments: ModelDeploymentsResource;
    readonly modelCatalog: ModelCatalogResource;
    readonly account: AccountResource;
    readonly evalSummary: EvalSummaryResource;
    readonly tenantTemplates: TenantTemplatesResource;
    constructor(options: SolverClientOptions);
}
export {};
