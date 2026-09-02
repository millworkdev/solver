import { HttpClient } from "./httpClient.js";
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
/**
 * `new Solver({ apiKey, baseUrl, maxRetries, retryBackoffMs })`, per
 * the SDK design's "Client construction". One namespace per core
 * object. Every resource is a thin wrapper over its live v1 endpoint; no
 * ranking, caching, or policy behavior runs on the client.
 *
 * The model-access chain reads left to right:
 * `modelSourceProfiles` (what can be connected) ->
 * `sourceCredentialHandoffs` (browser handoff; no secret ever transits the
 * SDK) -> `sourceConnections` (your provider-key binding) -> `modelDeployments`
 * (certification-backed supply) -> `modelCatalog` (usable intersection) ->
 * `arms.create({ model_deployment_id })` -> `executions` -> `receipts`.
 */
export class Solver {
    arms;
    verifiers;
    apiKeys;
    executions;
    receipts;
    proposals;
    usage;
    complianceExports;
    modelSourceProfiles;
    sourceCredentialHandoffs;
    sourceConnections;
    modelDeployments;
    modelCatalog;
    account;
    evalSummary;
    constructor(options) {
        const http = new HttpClient(options);
        this.arms = new ArmsResource(http);
        this.verifiers = new VerifiersResource(http);
        this.apiKeys = new ApiKeysResource(http);
        this.executions = new ExecutionsResource(http);
        this.receipts = new ReceiptsResource(http);
        this.proposals = new ProposalsResource(http);
        this.usage = new UsageResource(http);
        this.complianceExports = new ComplianceExportsResource(http);
        this.modelSourceProfiles = new ModelSourceProfilesResource(http);
        this.sourceCredentialHandoffs = new SourceCredentialHandoffsResource(http);
        this.sourceConnections = new SourceConnectionsResource(http);
        this.modelDeployments = new ModelDeploymentsResource(http);
        this.modelCatalog = new ModelCatalogResource(http);
        this.account = new AccountResource(http);
        this.evalSummary = new EvalSummaryResource(http);
    }
}
//# sourceMappingURL=client.js.map