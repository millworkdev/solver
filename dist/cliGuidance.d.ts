export declare const API_KEYS_URL = "https://app.getmillwork.dev/keys";
export declare const BILLING_URL = "https://app.getmillwork.dev/billing";
export declare const START_DOCS_URL = "https://docs.getmillwork.dev/get-started/tenant-start";
export declare const KEY_GUIDANCE = "No Millwork organization API key is available. In a local interactive terminal, tenant start can open a private browser page to check and save one for this computer. With --no-browser in an interactive terminal, it asks at a hidden prompt instead, including over SSH. Get it from Millwork dashboard \u2192 API keys at https://app.getmillwork.dev/keys. In CI, scripts, or any session without an interactive terminal, set SOLVERAPI_API_KEY from your secret store. Keep it out of chat and command arguments. A provider API key is a different credential.";
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
