export declare const VERIFIER_KIT_OUTPUT_VERSION = "millwork.verifier-kit.v1";
export declare const MAINTAINED_KIT_FILES: readonly ["handler.mjs", "compatibility-kit.mjs", "check-endpoint.mjs", "listing-example-check.mjs", "existing-node-app.mjs", "README.md", "DEPLOYMENT_RECIPE.md"];
/** The kit shipped inside this package. An installed customer has no Millwork
 *  checkout, so this is the only copy they can be handed. */
export declare function installedKitRoot(): string;
export declare function findMaintainedKitRoot(startDirectories: string[]): Promise<string>;
export declare function runVerifierKit(args: string[], cwd?: string, interactive?: boolean): Promise<number>;
