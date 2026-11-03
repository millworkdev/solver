import { createHmac, timingSafeEqual } from 'node:crypto';
const EVENTS = new Set(['provider.application.updated', 'provider.feed.validated', 'provider.route.updated']);
const object = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value, expected) => Object.keys(value).sort().join(',') === expected;
const identifier = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
function notification(value, deliveryId) {
    if (!object(value) || !keys(value, 'created_at,data,delivery_id,event,links')
        || value.delivery_id !== deliveryId || typeof value.event !== 'string' || !EVENTS.has(value.event)
        || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))
        || !object(value.data) || !keys(value.data, 'action,audit_id,schema_version,subject_id')
        || value.data.schema_version !== 'provider-event/v1' || !identifier(value.data.audit_id)
        || !identifier(value.data.subject_id, 512) || typeof value.data.action !== 'string'
        || !/^[a-z][a-z0-9_]{0,63}$/.test(value.data.action)
        || !object(value.links) || !keys(value.links, 'profile') || value.links.profile !== '/v1/providers/profile')
        return false;
    return true;
}
/** Offline verification of the timestamp + "." + raw-body protocol.
 * A fresh signature is required on every attempt (including duplicates). The
 * fixed five-minute window checks past and future timestamps. No network call,
 * process-global dedupe cache, credential logging or action execution occurs.
 */
export async function verifyProviderWebhook(input) {
    const malformed = { status: 'rejected', reason: 'malformed' };
    if (!(input.body instanceof Uint8Array) || input.body.byteLength === 0 || input.body.byteLength > 262_144
        || typeof input.signature !== 'string' || input.signature.length > 100 || !identifier(input.deliveryId)
        || !Array.isArray(input.signingSecrets) || input.signingSecrets.length < 1 || input.signingSecrets.length > 2
        || input.signingSecrets.some(secret => typeof secret !== 'string' || secret.length === 0 || secret.length > 1024)
        || typeof input.claimDelivery !== 'function')
        return malformed;
    const match = /^t=(0|[1-9][0-9]{0,11}),v1=([a-f0-9]{64})$/.exec(input.signature);
    const now = input.now ?? new Date();
    if (!match || !(now instanceof Date) || !Number.isFinite(now.getTime()))
        return malformed;
    const timestamp = Number(match[1]);
    if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > 300)
        return { status: 'rejected', reason: 'stale' };
    // Own a copy across the asynchronous inbox claim; later mutation of the
    // caller's request buffer cannot change the authenticated parsed notification.
    const bytes = Buffer.from(input.body);
    const supplied = Buffer.from(match[2], 'hex');
    let authenticated = false;
    for (const secret of input.signingSecrets) {
        const expected = createHmac('sha256', secret).update(match[1] + '.').update(bytes).digest();
        authenticated = timingSafeEqual(expected, supplied) || authenticated;
    }
    if (!authenticated)
        return { status: 'rejected', reason: 'invalid_signature' };
    let parsed;
    try {
        const text = bytes.toString('utf8');
        if (!Buffer.from(text, 'utf8').equals(bytes))
            return malformed;
        parsed = JSON.parse(text);
    }
    catch {
        return malformed;
    }
    if (!notification(parsed, input.deliveryId))
        return malformed;
    return { status: await input.claimDelivery(input.deliveryId, parsed) ? 'verified' : 'duplicate', notification: parsed };
}
