import type { HttpClient } from "../httpClient.js";
import type { Arm, ArmListFilter, ArmRegistrationOutcome, ArmWrite, Paginated } from "../types.js";
/** Wraps GET/POST/PATCH/DELETE /v1/arms, per the SDK design's resource namespaces. */
export declare class ArmsResource {
    private readonly http;
    constructor(http: HttpClient);
    /** POST answers the registration OUTCOME (arm_id/status/preflight),
     * not the full arm wire -- fetch via get() for the full object. */
    create(input: ArmWrite, opts?: {
        idempotencyKey?: string;
    }): Promise<ArmRegistrationOutcome>;
    list(filter?: ArmListFilter): Promise<Paginated<Arm>>;
    get(armId: string): Promise<Arm>;
    update(armId: string, patch: Partial<ArmWrite>, opts?: {
        idempotencyKey?: string;
    }): Promise<Arm>;
    disable(armId: string, opts?: {
        idempotencyKey?: string;
    }): Promise<Arm>;
}
