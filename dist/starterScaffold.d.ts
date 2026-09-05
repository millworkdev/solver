export declare const STARTER_CONFIG_PATH: string;
export declare const POOL_STARTER_CONFIG_PATH: string;
export declare const STARTER_ECHO_EXAMPLE_PATH: string;
export declare const STARTER_POOL_EXAMPLE_PATH: string;
export declare const STARTER_SCAFFOLD_CONTENTS: Record<string, string>;
export declare function writeApprovedScaffold(cwd: string, manifest: Array<{
    path: string;
}>): Promise<{
    written: string[];
    skipped_existing: string[];
}>;
