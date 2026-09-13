export type OrganizationKeyBootstrapResult = {
    state: "configured";
    apiKey: string;
} | {
    state: "cancelled" | "expired" | "browser_unavailable" | "storage_unavailable";
};
interface StorageOptions {
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    getUid?: () => number | undefined;
}
interface BootstrapOptions extends StorageOptions {
    apiBaseUrl: string;
    lifetimeMs?: number;
    now?: () => number;
    randomToken?: () => string;
    openBrowser?: (url: string) => Promise<"requested" | "unavailable" | "failed" | "timed_out">;
    validateKey?: (key: string, apiBaseUrl: string) => Promise<OrganizationKeyValidationResult>;
    saveKey?: (key: string, apiBaseUrl: string) => Promise<void>;
    onListening?: (url: string) => void;
}
export type OrganizationKeyValidationResult = "accepted" | "rejected" | "unavailable";
/** Load only an owner-private key bound to the exact intended API base. */
export declare function loadStoredOrganizationKey(apiBaseUrl: string, options?: StorageOptions): Promise<string | undefined>;
/** Atomically save one base-bound key without printing or returning its path. */
export declare function saveOrganizationKey(apiKey: string, apiBaseUrl: string, options?: StorageOptions): Promise<void>;
/**
 * Capture one organization key through a local single-use browser page. The
 * returned key remains process-local; the page, output, URL, and launcher never
 * contain it.
 */
export declare function bootstrapOrganizationKey(options: BootstrapOptions): Promise<OrganizationKeyBootstrapResult>;
export {};
