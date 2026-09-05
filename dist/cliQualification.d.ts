export type QualificationState = "no_credential" | "preview_pending_or_rejected" | "tenant_not_admitted" | "organization_invite_required" | "role_lacks_permission" | "pool_not_certified" | "pool_not_entitled" | "pool_no_capacity" | "approved";
export interface Qualification {
    state: QualificationState;
    next_action: {
        type: string;
        detail: string;
    };
    offered_plan?: {
        template_id: string;
        template_version: string;
        access_lane: "byok";
        application_supported: boolean;
        next_action: {
            type: string;
            detail: string;
        };
    };
}
export declare function qualifyMissingCredential(input: {
    apiKey?: string;
}): Qualification | null;
export declare function qualifyOrganizationInviteRequired(): Qualification;
export declare function qualifyPreviewPendingOrRejected(status: "pending" | "rejected"): Qualification;
export declare function qualifyTenantNotAdmitted(): Qualification;
export declare function qualifyRoleLacksPermission(role?: string): Qualification;
export declare function qualificationFromPlan(plan: {
    template_id?: string;
    effects?: Array<{
        id: string;
    }>;
    qualification?: {
        state: string;
        next_action: {
            type: string;
            detail: string;
        };
    };
    blockers?: Array<{
        code: string;
        next_action: {
            type: string;
            detail: string;
        };
    }>;
    alternative_plans?: Qualification["offered_plan"][];
}): Qualification | null;
export declare function qualificationFromApiError(error: unknown): Qualification | null;
