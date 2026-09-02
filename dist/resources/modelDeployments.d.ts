import type { HttpClient } from "../httpClient.js";
import type { ModelDeployment } from "../types.js";
/**
 * Connection-scoped, certification-backed model deployments
 * (`/v1/model-deployments`). Read-only: deployments are minted by
 * `sourceConnections.syncDeployments`, and an arm is enabled from one via
 * `arms.create({ model_deployment_id })`.
 */
export declare class ModelDeploymentsResource {
    private readonly http;
    constructor(http: HttpClient);
    list(): Promise<ModelDeployment[]>;
    get(modelDeploymentId: string): Promise<ModelDeployment>;
}
