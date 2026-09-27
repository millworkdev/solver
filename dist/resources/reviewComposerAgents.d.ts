import type { HttpClient } from "../httpClient.js";
import type { ReviewComposerAgentRegistration, ReviewComposerAgentRegistrationOutcome } from "../types.js";
import type { VerifierStopChoice } from "../verifierConnection.js";
export interface ReviewAgentConnection {
    status: string;
    handle: string | null;
    origin: string | null;
    generation: number;
    stop_at: string | null;
    days_remaining: number | null;
    pending_key: {
        handle: string;
        captured_generation: number;
        staged_until: string;
    } | null;
}
/** Dedicated private-agent registration bound to a verified GitHub connection. */
export declare class ReviewComposerAgentsResource {
    private readonly http;
    constructor(http: HttpClient);
    create(input: ReviewComposerAgentRegistration, opts: {
        idempotencyKey: string;
    }): Promise<ReviewComposerAgentRegistrationOutcome>;
    createConnectionIntent(armId: string, stopChoice: VerifierStopChoice): Promise<{
        intent_id: string;
        continue_url: string;
        origin: string;
        expires_at: string;
    }>;
    connection(armId: string): Promise<ReviewAgentConnection>;
    testConnection(armId: string, pending: {
        handle: string;
        captured_generation: number;
    }): Promise<{
        status: "active";
        handle: string;
        arm_id: string;
    }>;
    revokeConnection(armId: string, operationKey: string): Promise<{
        status: "revoked";
        arm_id: string;
    }>;
}
