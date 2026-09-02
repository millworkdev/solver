/** Thin wrapper over the live account/quota/allowance projection. `balance`
 * and `billing` arrive whole-object-or-null per the caller's billing
 * visibility (machine API keys read both). */
export class AccountResource {
    http;
    constructor(http) {
        this.http = http;
    }
    async get() {
        return this.http.request({ method: "GET", path: "account" });
    }
}
//# sourceMappingURL=account.js.map