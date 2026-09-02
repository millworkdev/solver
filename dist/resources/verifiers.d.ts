import type { HttpClient } from "../httpClient.js";
import type { Paginated, Verifier, VerifierListFilter, VerifierRegistrationOutcome, VerifierTestReport, VerifierUpdate, VerifierWrite } from "../types.js";
/** Wraps GET/POST /v1/verifiers, per the SDK design's resource namespaces. */
export declare class VerifiersResource {
    private readonly http;
    constructor(http: HttpClient);
    /** POST answers the registration OUTCOME (id/hash/status/preflight),
     * not the full verifier wire -- fetch via get() for the full object. */
    create(input: VerifierWrite, opts?: {
        idempotencyKey?: string;
    }): Promise<VerifierRegistrationOutcome>;
    list(filter?: VerifierListFilter): Promise<Paginated<Verifier>>;
    get(verifierId: string): Promise<Verifier>;
    /** PATCH echoes the full updated verifier; `revision` bumps on update. */
    update(verifierId: string, input: VerifierUpdate, opts?: {
        idempotencyKey?: string;
    }): Promise<Verifier>;
    /** Probes the endpoint and persists the observed health; `revision` is
     * deliberately untouched -- health is observation, not identity. */
    test(verifierId: string, opts?: {
        idempotencyKey?: string;
    }): Promise<VerifierTestReport>;
    /** Retires the verifier (204, idempotent). */
    retire(verifierId: string, opts?: {
        idempotencyKey?: string;
    }): Promise<void>;
}
