import type { Solver } from "./client.js";
export type VerifierBrowserLaunch = "requested" | "unavailable" | "failed" | "timed_out";
type VerifierKeyEntryRecovery = {
    kind: "recovered";
    staged: {
        handle: string;
        captured_generation: number;
    };
} | {
    kind: "pending";
} | {
    kind: "unknown";
};
type VerifierKeyEntryAcquisition = {
    kind: "staged";
    staged: {
        handle: string;
        captured_generation: number;
    };
} | {
    kind: "secret";
    secret: string;
} | {
    kind: "resume";
};
export declare function verifierEntryBrowserRequested(input: {
    args: readonly string[];
    interactive: boolean;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
}): boolean;
/** One browser/terminal decision for connect, replace, and restore. */
export declare function acquireVerifierKeyEntry(input: {
    args: readonly string[];
    interactive: boolean;
    continueUrl: string;
    expiresAt: string;
    existingSecret?: string;
    readSecret(): Promise<string | undefined>;
    recover(): Promise<VerifierKeyEntryRecovery>;
    openBrowser?: (url: string) => Promise<VerifierBrowserLaunch>;
    out(text: string): void;
    err(text: string): void;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    sleep?: (milliseconds: number) => Promise<void>;
    maxPolls?: number;
    now?: () => number;
}): Promise<VerifierKeyEntryAcquisition>;
export type VerifierIntakeFailure = "authentication_refused" | "admission_refused" | "request_refused" | "intake_refused" | "rate_limited" | "outcome_unknown" | "unavailable";
export declare class VerifierIntakeError extends Error {
    readonly failure: VerifierIntakeFailure;
    readonly status: number | null;
    readonly retryAfterSeconds: number | null;
    constructor(failure: VerifierIntakeFailure, status: number | null, retryAfterSeconds?: number | null);
    get mayHaveCommitted(): boolean;
}
export interface VerifierIntakeResult {
    handle: string;
    captured_generation: number;
}
/** Accept the verifier intake only when its origin matches an independently trusted origin. */
export declare function trustedVerifierIntakeUrl(continueUrl: string, trustedOrigin: string): URL;
/** Posts a key once and converts every refusal into a typed, secret-free outcome. */
export declare function submitVerifierIntake(input: {
    url: URL;
    secret: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
}): Promise<VerifierIntakeResult>;
/**
 * `millwork verifier replace | restore | continue | disconnect`.
 *
 * Replace and restore enter a new key the same way `verifier connect` does:
 * the key goes only to the trusted customer-app intake over HTTPS, with the
 * creating API key, never through `/v1`, never echoed, logged or stored
 * locally. The outcome is always read back from `GET .../connection`, so a
 * failed replacement is reported as "your previous key is still selected"
 * only when custody says so. Millwork's state is never described as the
 * key's state at the customer's endpoint.
 *
 * Exit status: 0 done, 1 the key's test did not pass, 2 action required or
 * usage (for example the key must be entered on the private page).
 */
export type VerifierLifecycleCommand = "replace" | "restore" | "continue" | "disconnect";
export declare const VERIFIER_LIFECYCLE_COMMANDS: ReadonlySet<string>;
export interface VerifierLifecycleIo {
    interactive: boolean;
    out(text: string): void;
    err(text: string): void;
    emitJson(document: Record<string, unknown>): void;
    /** The key from VERIFIER_CONNECTION_SECRET or a private non-echoing prompt; undefined when neither is available. */
    readSecret(): Promise<string | undefined>;
    confirm(question: string): Promise<boolean>;
    apiKey: string;
    fetchImpl?: typeof fetch;
    existingSecret?: string;
    openBrowser?: (url: string) => Promise<VerifierBrowserLaunch>;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    sleep?: (milliseconds: number) => Promise<void>;
    maxPolls?: number;
    now?: () => number;
    /** Explicit local pin, normally CUSTOMER_APP_ORIGIN. */
    trustedIntakeOrigin?: string;
    /** Authenticated API origin used only with an older server response. */
    serverOrigin?: string;
}
export declare class VerifierLifecycleUsageError extends Error {
}
type ConnectionClient = Pick<Solver, "verifierConnection">;
export declare function runVerifierLifecycle(solver: ConnectionClient, command: VerifierLifecycleCommand, args: string[], io: VerifierLifecycleIo): Promise<number>;
export {};
