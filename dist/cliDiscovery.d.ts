export declare const TENANT_START_DOCS_URL = "https://docs.getmillwork.dev/get-started/tenant-start?utm_source=millwork_cli&utm_medium=cli&utm_campaign=tenant_onramp";
export declare const DEFAULT_API_BASE_URL = "https://api.getmillwork.dev/v1";
export declare const TESTED_NODE_MAJORS: readonly [20, 22];
export interface CliDiscoveryEnvironment {
    SOLVERAPI_API_KEY?: string;
    SOLVERAPI_BASE_URL?: string;
}
export interface CliDiscoveryResult {
    exitCode: number;
    stream: "stdout" | "stderr";
    text: string;
}
export declare function buildDoctorReport(environment: CliDiscoveryEnvironment, nodeVersion?: string): Record<string, unknown>;
export declare function resolveDiscoveryCommand(args: string[], environment?: CliDiscoveryEnvironment, nodeVersion?: string): CliDiscoveryResult | null;
