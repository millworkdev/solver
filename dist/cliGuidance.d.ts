export declare const API_KEYS_URL = "https://app.getmillwork.dev/keys";
export declare const BILLING_URL = "https://app.getmillwork.dev/billing";
export declare const START_DOCS_URL = "https://docs.getmillwork.dev/get-started/tenant-start";
export declare const KEY_GUIDANCE = "Use your organization's Millwork API key. Find an existing key, or create one if needed, at https://app.getmillwork.dev/keys and set SOLVERAPI_API_KEY privately in the terminal running Millwork.";
/** Support output is not a dump of request bodies, headers, or private URLs. */
export declare function safeErrorText(value: unknown): string;
export declare function cliApiError(error: unknown): {
    next_action: {
        type: string;
        detail: string;
        url: string;
    };
    retry_after_s?: number | undefined;
    request_id: string;
    errors?: {
        field: string;
        message: string;
    }[] | undefined;
    detail?: string | undefined;
    state: string;
    error: string;
    status: number;
    title: string;
} | null;
