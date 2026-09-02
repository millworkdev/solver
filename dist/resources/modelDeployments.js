/**
 * Connection-scoped, certification-backed model deployments
 * (`/v1/model-deployments`). Read-only: deployments are minted by
 * `sourceConnections.syncDeployments`, and an arm is enabled from one via
 * `arms.create({ model_deployment_id })`.
 */
export class ModelDeploymentsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async list() {
        const response = await this.http.request({
            method: "GET",
            path: "model-deployments",
        });
        return response.deployments;
    }
    async get(modelDeploymentId) {
        return this.http.request({
            method: "GET",
            path: `model-deployments/${encodeURIComponent(modelDeploymentId)}`,
        });
    }
}
//# sourceMappingURL=modelDeployments.js.map