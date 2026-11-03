import { buildSupplierStatement, checkSupplierStatement, parseSupplierStatement } from '#provider-feed-validator';
export { verifyProviderWebhook } from './webhookVerifier.js';
export { buildSupplierStatement, checkSupplierStatement, parseSupplierStatement };
import { SolverApiError } from "../errors.js";
import { HttpClient } from "../httpClient.js";
import { validateProviderFeed, validateProviderProfile } from "#provider-feed-validator";
export { validateProviderFeed, validateProviderProfile, PROVIDER_FEED_SCHEMA, PROVIDER_INCUMBENT_FEED_SCHEMA, PROVIDER_PROFILE_SCHEMA, PROVIDER_FEED_VERSION, PROVIDER_VALIDATOR_VERSION, providerDigest } from "#provider-feed-validator";
import { validateProviderPortableContext } from "#provider-validation-context";
export { validateProviderPortableContext, PROVIDER_PORTABLE_VALIDATION_CONTEXT_SCHEMA, PROVIDER_ISSUED_VALIDATION_CONTEXT_SCHEMA } from "#provider-validation-context";
export function checkProviderFeed(feed, context) {
    const { profile, now, ...portable } = context;
    if (!validateProviderProfile(profile) || !validateProviderPortableContext(portable)
        || (now !== undefined && (!(now instanceof Date) || !Number.isFinite(now.getTime())))) {
        throw new Error("Use a valid provider profile, issued validation context, and a valid validation time.");
    }
    return validateProviderFeed(feed, context);
}
export const PROVIDER_SECRET_REPLAY_RECOVERY = "List the existing keys, or revoke the key whose secret was lost, then explicitly mint a new key. The old secret cannot be recovered; do not repeat the creation request.";
/** A withheld once-only secret is a recovery task, never a retryable creation. */
export class ProviderSecretReplayUnavailableError extends SolverApiError {
    code = "idempotent_replay_secret_unavailable";
    recovery = "list_or_revoke_then_mint_new_key";
    constructor(error) {
        super({ type: error.type, status: 409, title: "Key secret unavailable after replay. " + PROVIDER_SECRET_REPLAY_RECOVERY,
            detail: PROVIDER_SECRET_REPLAY_RECOVERY, instance: error.instance });
        this.name = "ProviderSecretReplayUnavailableError";
    }
}
const requireFeedEtag = (token) => {
    if (!/^"provider-feed-v1:[0-9]+:[0-9]+"$/.test(token))
        throw new Error("Pass the feed_etag read with your draft as If-Match.");
};
const reference = (value) => encodeURIComponent(value);
/** Provider metadata only. No approval, paid probe, custody, or listing mutation is exposed. */
export class ProviderClient {
    http;
    singleAttemptHttp;
    constructor(options) {
        const url = new URL(options.baseUrl);
        if (url.username || url.password || url.search || url.hash
            || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
            throw new Error("Use an HTTPS API base URL, or a credential-free loopback URL for local tests.");
        }
        this.http = new HttpClient(options);
        this.singleAttemptHttp = new HttpClient({ ...options, maxRetries: 0 });
    }
    async request(options, oneAttempt = false) {
        try {
            return await (oneAttempt ? this.singleAttemptHttp : this.http).request(options);
        }
        catch (error) {
            if (error instanceof SolverApiError && error.status === 409 && error.type.split("/").pop() === "idempotent_replay_secret_unavailable") {
                throw new ProviderSecretReplayUnavailableError(error);
            }
            throw error;
        }
    }
    workspace() {
        return this.request({ method: "GET", path: "providers/workspace" }, true);
    }
    /** The archived supply view. Same bytes as the workspace reads; no approval or commit. */
    supplyGrants() {
        return this.request({ method: "GET", path: "providers/pooled-supply/grants" }, true);
    }
    supplyRequests(cursor) {
        return this.request({ method: "GET", path: "providers/pooled-supply/requests", query: cursor ? { cursor } : undefined }, true);
    }
    supplyRequest(requestId) {
        return this.request({ method: "GET", path: `providers/pooled-supply/requests/${reference(requestId)}` }, true);
    }
    supplyStatements() {
        return this.request({ method: "GET", path: "providers/pooled-supply/statements" }, true);
    }
    supplyStatement(statementId) {
        return this.request({ method: "GET", path: `providers/pooled-supply/statements/${reference(statementId)}` }, true);
    }
    statementPreflight(document) {
        return this.request({ method: 'POST', path: 'providers/supplier-statements/preflight', body: document }, true);
    }
    statementCommit(document, preflightId, approvalId) {
        if (!/^[a-f0-9]{64}$/.test(preflightId) || approvalId !== undefined && !/^maa_[A-Za-z0-9]+$/.test(approvalId))
            throw new Error('Use the reviewed preflight id and owner or admin approval reference.');
        return this.request({ method: 'POST', path: 'providers/supplier-statements/commit', body: { ...document, preflight_id: preflightId, ...(approvalId ? { approval_id: approvalId } : {}) } }, true);
    }
    statementStatus(statementId) {
        return this.request({ method: 'GET', path: `providers/supplier-statements/${reference(statementId)}` }, true);
    }
    checkFeedOnline(feed, ifMatch) {
        requireFeedEtag(ifMatch);
        return this.request({ method: "POST", path: "providers/feeds/check", body: feed, ifMatch });
    }
    routeLifecycle(routeId, input, ifMatch) {
        requireFeedEtag(ifMatch);
        if (typeof routeId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(routeId)
            || !input || Object.keys(input).sort().join(",") !== "lifecycle,revision_id,subject_sha256"
            || input.lifecycle !== "deprecated" || !/^[A-Za-z0-9_-]{1,200}$/.test(input.revision_id)
            || !/^[a-f0-9]{64}$/.test(input.subject_sha256))
            throw new Error("Deprecation requires the exact route, revision and subject digest. Withdrawal requires separate owner or admin approval.");
        return this.request({ method: "POST", path: `providers/routes/${reference(routeId)}/lifecycle`, body: input, ifMatch });
    }
    profile() { return this.request({ method: "GET", path: "providers/profile" }); }
    validationContext() { return this.request({ method: "GET", path: "providers/validation-context" }); }
    updateProfile(profile, profileRevision) {
        return this.request({ method: "PATCH", path: "providers/profile", body: { profile, profile_revision: profileRevision } });
    }
    domainChallenge() {
        return this.request({ method: "POST", path: "providers/domain-challenges", body: {} });
    }
    verifyDomain(challengeId) {
        return this.request({ method: "POST", path: `providers/domain-challenges/${reference(challengeId)}/verify`, body: {} });
    }
    submitFeed(feed, ifMatch) {
        if (!/^"provider-feed-v1:[0-9]+:[0-9]+"$/.test(ifMatch))
            throw new Error("Pass the feed_etag read with your draft as If-Match.");
        return this.request({ method: "POST", path: "providers/feeds", body: feed, ifMatch });
    }
    feedSource() { return this.request({ method: "GET", path: "providers/feed-source" }); }
    configureFeedSource(body) {
        return this.request({ method: "PUT", path: "providers/feed-source", body });
    }
    refreshFeed(ifMatch, dryRun = false) {
        if (!/^"provider-feed-v1:[0-9]+:[0-9]+"$/.test(ifMatch))
            throw new Error("Pass the feed_etag read with your draft as If-Match.");
        return this.request({ method: "POST", path: "providers/feed-pulls", body: { dry_run: dryRun }, ifMatch });
    }
    feedPulls() { return this.request({ method: "GET", path: "providers/feed-pulls" }); }
    webhooks() { return this.request({ method: "GET", path: "providers/webhooks" }); }
    createWebhook(url, events) {
        return this.request({ method: "POST", path: "providers/webhooks", body: { url, events } });
    }
    setWebhookStatus(webhookId, status) {
        return this.request({ method: "PATCH", path: `providers/webhooks/${reference(webhookId)}`, body: { status } });
    }
    rotateWebhookSecret(webhookId) {
        return this.request({ method: "POST", path: `providers/webhooks/${reference(webhookId)}/rotate-secret`, body: {} });
    }
    webhookDeliveries(webhookId, status) {
        return this.request({ method: "GET", path: `providers/webhooks/${reference(webhookId)}/deliveries`, query: { status } });
    }
    replayWebhookDelivery(deliveryId) {
        return this.request({ method: "POST", path: `providers/webhooks/deliveries/${reference(deliveryId)}/replay`, body: {} });
    }
}
