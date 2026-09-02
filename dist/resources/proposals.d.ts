import type { HttpClient } from "../httpClient.js";
import type { Paginated, Proposal, ProposalListFilter } from "../types.js";
/**
 * Thin wrappers over the live proposal queue and decision routes.
 */
export declare class ProposalsResource {
    private readonly http;
    constructor(http: HttpClient);
    list(filter?: ProposalListFilter): Promise<Paginated<Proposal>>;
    get(proposalId: string): Promise<Proposal>;
    approve(proposalId: string): Promise<Proposal>;
    reject(proposalId: string, reason?: string): Promise<Proposal>;
}
