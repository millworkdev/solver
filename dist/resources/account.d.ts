import type { HttpClient } from "../httpClient.js";
import type { Account } from "../types.js";
/** Thin wrapper over the live account/quota/allowance projection. `balance`
 * and `billing` arrive whole-object-or-null per the caller's billing
 * visibility (machine API keys read both). */
export declare class AccountResource {
    private readonly http;
    constructor(http: HttpClient);
    get(): Promise<Account>;
}
