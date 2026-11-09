export declare function runSupplierCli(args: string[]): Promise<void>;
/** Resolve the whole grammar before credentials, files or HTTP are touched. */
export declare function parseOfferCommand(args: string[]): {
    command: string;
    routeId?: string;
    supply?: {
        noun: string;
        id?: string;
    };
    flags: Map<string, string | true>;
};
export declare function createLoginPkce(): {
    verifier: string;
    challenge: string;
};
export declare function providerKeyFile(): string;
export interface ProviderCredentialStore {
    available: boolean;
    write(key: string): void;
    read(): string | undefined;
    delete?(): void;
}
export declare function osCredentialStore(kind: "darwin" | "linux" | "win32"): ProviderCredentialStore;
export declare function storeProviderKey(key: string, filePath: string, apiBase: string): void;
export declare function readStoredProviderKey(filePath?: string, apiBase?: string): string | undefined;
export declare function storeProviderCredential(key: string, options: {
    filePath?: string;
    osStore?: ProviderCredentialStore;
    apiBase: string;
}): void;
export declare function readProviderCredential(filePath?: string, osStore?: ProviderCredentialStore, apiBase?: string | undefined): string | undefined;
export declare function runProviderLogout(options?: {
    apiUrl?: string;
    keyFile?: string;
    osStore?: ProviderCredentialStore;
    fetchImpl?: typeof fetch;
    stdout?: (chunk: string) => void;
    stderr?: (chunk: string) => void;
}): Promise<void>;
export declare function runProviderLogin(flags: Map<string, string | true>, options?: {
    apiUrl?: string;
    dashboardUrl?: string;
    keyFile?: string;
    osStore?: ProviderCredentialStore;
    fetchImpl?: typeof fetch;
    stdout?: (chunk: string) => void;
    stderr?: (chunk: string) => void;
    timeoutMs?: number;
}): Promise<void>;
export declare function runOfferCli(args: string[]): Promise<void>;
export declare function parseStatementCommand(args: string[]): {
    command: string;
    flags: Map<string, string | true>;
};
export declare function runStatementCli(args: string[]): Promise<void>;
