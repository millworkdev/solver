export declare const VERIFIER_KIT_OUTPUT_VERSION = "millwork.verifier-kit.v1";
export declare const MAINTAINED_KIT_FILES: readonly ["handler.mjs", "compatibility-kit.mjs", "check-endpoint.mjs", "listing-example-check.mjs", "minimal-output-check.mjs", "recipe-a-structured-output.mjs", "recipe-b-semantic-judgment.mjs", "recipe-c-evaluator-adapter.mjs", "recipe-d-completion-evidence.mjs", "selected-check.mjs", "existing-node-app.mjs", "minimal-node-dock.mjs", "minimal-python-dock.py", "README.md", "DEPLOYMENT_RECIPE.md"];
export declare const RECIPE_CHECK_FILES: Readonly<{
    default: "listing-example-check.mjs";
    "0": "minimal-output-check.mjs";
    a: "recipe-a-structured-output.mjs";
    b: "recipe-b-semantic-judgment.mjs";
    c: "recipe-c-evaluator-adapter.mjs";
    d: "recipe-d-completion-evidence.mjs";
}>;
/** The kit shipped inside this package. An installed customer has no Millwork
 *  checkout, so this is the only copy they can be handed. */
export declare function installedKitRoot(): string;
export declare function findMaintainedKitRoot(startDirectories: string[]): Promise<string>;
export declare function runVerifierKit(args: string[], cwd?: string, interactive?: boolean): Promise<number>;
