import type { HttpClient } from "./httpClient.js";
import type { VerifierConnectionView } from "./types.js";
export type VerifierStopChoice = {
    kind: "no_expiration";
} | {
    kind: "preset_days";
    days: 30 | 90 | 180 | 365;
} | {
    kind: "calendar_date";
    date: string;
    time_zone: string;
};
export interface VerifierConnectionIntent {
    continue_url: string;
    intake_origin: string;
    intent_id: string;
    origin: string;
    expires_at: string;
    stop_choice?: VerifierStopChoice;
}
export type VerifierLifecycleOutcome = {
    state: "action_required";
    next_action: "enter_key";
    connection: VerifierConnectionView;
} | {
    state: "pending" | "unknown";
    next_action: "resume";
    connection: VerifierConnectionView | null;
} | {
    state: "test_failed";
    next_action: "start_again";
    connection: VerifierConnectionView;
} | {
    state: "changed" | "nothing_pending";
    next_action: "inspect";
    connection: VerifierConnectionView;
} | {
    state: "refused";
    next_action: "inspect";
    connection: VerifierConnectionView | null;
    error: {
        status: number;
        title: string;
    };
} | {
    state: "done";
    next_action: null;
    connection: VerifierConnectionView;
};
/** Secretless protected verifier lifecycle. Enter the key only on the private page. */
export declare class VerifierConnection {
    private readonly http;
    constructor(http: HttpClient);
    createIntent(verifierId: string, stopChoice: VerifierStopChoice, opts?: {
        idempotencyKey?: string;
    }): Promise<VerifierConnectionIntent>;
    inspect(verifierId: string, opts?: {
        operationKey?: string;
    }): Promise<VerifierConnectionView>;
    /** A resume keeps operationKey, but uses a fresh request idempotencyKey. */
    testAndPromote(verifierId: string, input: {
        handle: string;
        captured_generation: number;
    }, opts?: {
        idempotencyKey?: string;
        operationKey?: string;
    }): Promise<{
        generation: number;
        handle: string;
    }>;
    revoke(verifierId: string, opts?: {
        idempotencyKey?: string;
        operationKey?: string;
    }): Promise<{
        generation: number;
    }>;
    /** Continue only the key staged for this intent, then read back the actual state. */
    continue(verifierId: string, operationKey: string, requestKey: string): Promise<VerifierLifecycleOutcome>;
    /** Explicit confirmation is required because disconnect is a write. */
    disconnect(verifierId: string, operationKey: string, requestKey: string, confirmed: boolean): Promise<VerifierLifecycleOutcome>;
    private safeInspect;
    private classifyPromotion;
}
