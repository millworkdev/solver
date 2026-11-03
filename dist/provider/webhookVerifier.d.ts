import type { ProviderWebhookEvent } from './index.js';
/** A signed hint to read current provider state; never execution or listing authority. */
export interface ProviderWebhookNotification {
    delivery_id: string;
    event: ProviderWebhookEvent;
    created_at: string;
    data: {
        schema_version: 'provider-event/v1';
        audit_id: string;
        action: string;
        subject_id: string;
    };
    links: {
        profile: '/v1/providers/profile';
    };
}
export interface ProviderWebhookVerificationInput {
    /** Exact request bytes before any JSON middleware, reformatting or decoding. */
    body: Uint8Array;
    signature: string | undefined;
    deliveryId: string | undefined;
    /** Current secret, optionally followed by the previous secret during rotation. */
    signingSecrets: readonly string[];
    now?: Date;
    /** Atomically persist an inbox row, scoped to this endpoint, before returning true.
     * Return false if already retained. Process that durable inbox separately so a
     * crash after this claim cannot lose the event. Storage failures propagate for retry.
     */
    claimDelivery(deliveryId: string, notification: ProviderWebhookNotification): Promise<boolean>;
}
export type ProviderWebhookVerification = {
    status: 'verified' | 'duplicate';
    notification: ProviderWebhookNotification;
} | {
    status: 'rejected';
    reason: 'malformed' | 'stale' | 'invalid_signature';
};
/** Offline verification of the timestamp + "." + raw-body protocol.
 * A fresh signature is required on every attempt (including duplicates). The
 * fixed five-minute window checks past and future timestamps. No network call,
 * process-global dedupe cache, credential logging or action execution occurs.
 */
export declare function verifyProviderWebhook(input: ProviderWebhookVerificationInput): Promise<ProviderWebhookVerification>;
