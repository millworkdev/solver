import { InspectionUsageError } from "./cliInspection.js";
import { terminalText } from "./tenantStartOutput.js";
const commands = new Set(["account", "balance", "fee", "usage", "receipt", "quote", "allowance"]);
/** Resolve the complete read grammar before loading a key or making a request. */
export function resolveCustomerReadCommand(args) {
    const name = args[0];
    if (!name || !commands.has(name))
        return null;
    const tail = args.slice(1);
    const positionals = [];
    const flags = new Map();
    const allowed = name === "usage" ? ["--period"] : name === "quote" ? ["--provider-usage-budget-usd"] : [];
    for (let index = 0; index < tail.length; index += 1) {
        const value = tail[index];
        if (value === "--json") {
            if (flags.has(value))
                throw new InspectionUsageError(`Duplicate argument: ${value}`);
            flags.set(value, "");
        }
        else if (allowed.includes(value)) {
            if (flags.has(value))
                throw new InspectionUsageError(`Duplicate argument: ${value}`);
            const argument = tail[++index];
            if (!argument || argument.startsWith("--"))
                throw new InspectionUsageError(`${value} requires a value`);
            flags.set(value, argument);
        }
        else if (value.startsWith("-")) {
            throw new InspectionUsageError(`Unsupported read-only argument: ${terminalText(value)}`);
        }
        else
            positionals.push(value);
    }
    if (name === "usage") {
        const period = flags.get("--period");
        if (positionals.length || !period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
            throw new InspectionUsageError("usage: millwork usage --period YYYY-MM [--json]");
        }
        return { kind: "usage", period };
    }
    if (name === "receipt") {
        if (positionals.length !== 1)
            throw new InspectionUsageError("usage: millwork receipt <execution-id> [--json]");
        return { kind: "receipt", executionId: positionals[0] };
    }
    if (name === "quote") {
        const budget = flags.get("--provider-usage-budget-usd");
        if (positionals.length !== 1 || !budget || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(budget)
            || !Number.isFinite(Number(budget)) || Number(budget) <= 0) {
            throw new InspectionUsageError("usage: millwork quote <model-deployment-id> --provider-usage-budget-usd <positive USD, up to six decimal places> [--json]");
        }
        return { kind: "quote", deploymentId: positionals[0], providerBudgetUsd: Number(budget) };
    }
    if (positionals.length && !(name === "account" && positionals.length === 1 && positionals[0] === "show")) {
        throw new InspectionUsageError(`usage: millwork ${name} [--json]`);
    }
    return { kind: name };
}
/** Preserve unavailable billing as unavailable, without exposing billing contacts or ledger history. */
export function customerAccountSummary(account) {
    return {
        tenant_id: account.tenant_id,
        balance: account.balance === null ? null : { balance_usd: account.balance.balance_usd },
        billing: account.billing,
        quota: account.quota,
        unavailable_reason: account.billing === null || account.balance === null ? "billing_not_visible"
            : account.billing.payment_unavailable_reason ?? (account.balance.balance_usd <= 0
                || (typeof account.billing.platform_fee_usd_per_execution === "number"
                    && account.balance.balance_usd < account.billing.platform_fee_usd_per_execution) ? "insufficient_credit"
                : account.billing.funded_state === "sandbox" ? "spending_unavailable" : null),
        billing_path: "/billing",
    };
}
export async function runCustomerReadCommand(command, solver) {
    let data;
    switch (command.kind) {
        case "account":
        case "balance":
        case "fee":
            data = customerAccountSummary(await solver.account.get());
            break;
        case "usage":
            data = await solver.usage.get(command.period);
            break;
        case "receipt":
            data = await solver.receipts.get(command.executionId);
            break;
        case "quote":
            data = await solver.modelCatalog.quote({ model_deployment_id: command.deploymentId,
                provider_usage_budget_usd: command.providerBudgetUsd });
            break;
        case "allowance": {
            const plan = await solver.tenantTemplates.plan({ template_id: "pooled-open-model" });
            data = { template_id: plan.template_id, template_version: plan.template_version,
                allowance: plan.request_policy?.budget ?? null, starter_credit: plan.starter_credit,
                qualification: plan.qualification, blockers: plan.blockers, billing_path: "/billing",
                note: "This is the template pool spending allowance, not a price quote or approval to run." };
            break;
        }
    }
    const document = { schema_version: "millwork.customer-read.v1", operation: command.kind, read_only: true, data };
    return { document, human: `${terminalText(command.kind)} — read only\n${terminalText(JSON.stringify(data, null, 2), true)}\n`
            + (["account", "balance", "fee", "allowance"].includes(command.kind) ? "Billing: /billing in your signed-in dashboard. No checkout or run was started.\n" : "") };
}
