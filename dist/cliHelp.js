import { VERIFIER_COMMANDS, VERIFIER_DOCK_CONTRACT } from "./cliVerifierCapabilities.js";
/**
 * `millwork --help` used to fall through to the same stderr usage line and
 * the same exit 2 as a typo. An agent that runs --help first -- which is the
 * one thing every agent does first -- read that as "this CLI is broken" and
 * had no way to find out what it could actually do.
 *
 * Asking for help is not an error, so it exits 0 on stdout, and it does one
 * more thing: it names the offline command that answers the question properly.
 * The usage line stays exactly what it was for a real usage error.
 */
export const USAGE_LINE = "usage: millwork <account show|balance|fee|usage --period YYYY-MM|receipt <execution-id>|quote <deployment-id> --provider-usage-budget-usd <USD>|allowance|offer|supplier|docs|doctor|--version|models list|models use <catalog-model>|models add <catalog-model>|models inventory <operation>|arms disable <arm-id>|run --preset <id> --objective <task>|provider list|provider connect <source-id>|provider rotate <connection-id>|provider disconnect <connection-id>|verifier capabilities|verifier attach --endpoint <url> --auth-ref <handle>|verifier connect --endpoint <url> --access public|managed|verifier init|verifier test --local|verifier list|verifier show|verifier test|verifier <replace|restore|continue|disconnect> --verifier-id <id>|tenant show|tenant start> [options]";
const HELP_FLAGS = new Set(["--help", "-h", "help"]);
export function topLevelHelpText() {
    const offline = VERIFIER_COMMANDS.filter((entry) => entry.network === "none");
    return [
        USAGE_LINE,
        "",
        "Output checks (verifiers). For the full surface this install accepts, with every",
        "flag, every command-local choice, and what each command costs in network calls,",
        "credentials and money, read it offline:",
        "",
        "  millwork verifier capabilities --json",
        "",
        "That command needs no account key and makes no network call. These need neither:",
        ...offline.map((entry) => `  millwork ${entry.command}`),
        "",
        "Connected checks are operated with:",
        ...VERIFIER_COMMANDS.filter((entry) => entry.network !== "none").map((entry) => `  millwork ${entry.command}`),
        "",
        `Dock contract: ${VERIFIER_DOCK_CONTRACT.url}`,
        "",
        "millwork docs            open the documentation",
        "millwork doctor          check this machine's configuration",
        "millwork --version       the installed package version",
        "",
        "Customer reads (organization key required; no checkout, terms acceptance or run):",
        "  millwork account show",
        "  millwork balance",
        "  millwork fee",
        "  millwork usage --period YYYY-MM",
        "  millwork receipt <execution-id>",
        "  millwork quote <model-deployment-id> --provider-usage-budget-usd <USD>",
        "  millwork allowance     template pool allowance, not a price quote",
        "  Add --json for structured output. These reads are built here; installation availability follows the release.",
        "",
        "Account inventory (separate from the tested catalog; no paid task is started):",
        "  millwork models inventory list --connection-id <id> [--cursor <opaque cursor>] --json",
        "  millwork models inventory facets --connection-id <id> --json",
        "  millwork models inventory show <item-id> --json",
        "  millwork models inventory refresh <connection-id> --yes --idempotency-key <original-key> --json",
        "  millwork models inventory import-status <import-id> --json",
        "  millwork models inventory plan --input <original-plan-inputs.json> --json",
        "  millwork models inventory authorize --input <reviewed-plan-output.json> --yes --idempotency-key <original-key> --json",
        "  millwork models inventory authority <authority-id> --json",
        "  millwork models inventory authorization-status <original-operation-key> --json",
        "  millwork models inventory quote --input <original-execute-quote-inputs.json> --json",
        "  millwork models inventory add --input <returned-authority-output.json> --yes --idempotency-key <original-registration-key> --json",
        "  Review the exact original plan inputs/token/digest and separate confirmation/permission expiries.",
        "  Retain the original file/key after uncertainty. Read authorization-status; do not remint or replan automatically.",
        "  Add forwards the exact returned registration template. It grants no paid-run approval or Tested by Millwork standing.",
        "",
        "Selected-model checks (this source checkout; 1–20 explicitly selected routes, no selection expansion):",
        "  millwork models inventory checks plan --input <original-selection.json> --json",
        "  millwork models inventory checks status <batch-id> --json",
        "  millwork models inventory checks operation-status <original-operation-key> --json",
        "  millwork models inventory checks cancel <batch-id> --input <original-cancel.json> --yes --idempotency-key <original-key> --json",
        "  millwork models inventory checks start --input <reviewed-plan.json> --yes --idempotency-key <original-key> --json",
        "  millwork models inventory checks resume <batch-id> --input <original-resume.json> --yes --idempotency-key <original-key> --json",
        "  Plan is free. Status is passive; operation-status separates the recovered historical response from current progress.",
        "  Cancel input is {\"expected_revision\": <current revision>}. Retain the original file/key after uncertainty.",
        "  Cancellation stops new accepts; upstream work may finish or be billed. It does not prove an abort or refund.",
        "  Paid start/resume refuse before files, credentials or network: host_batch_approval_required.",
        "  The current host supports one-run approval only. Review a batch in the dashboard or an explicitly controlled API client.",
        "  --yes, a prompt or single-run approval cannot authorize a batch. Installation availability follows the separate release.",
        "",
        "Tested customer-owned runs check settled credit and fetch the exact price before requesting host approval.",
        "  The printed retry carries --price-approval-sha256; keep it and the replay key unchanged.",
        "  Inventory arms require --inventory-approval <original-reviewed-execute-approval.json> with the signed execute plan, original task inputs, authority ID, provider budget and exact quote hash.",
        "  Keep that original file and replay key unchanged. Permission is separate from testing and host paid-run approval; unknown paid exposure stays unresolved.",
        "  The API key can spend. A quote, --yes, or a tool argument cannot replace host approval.",
    ].join("\n");
}
/** Resolved before anything that could read a key or reach the network. */
export function resolveTopLevelHelp(args) {
    if (args.length === 0 || !HELP_FLAGS.has(args[0]))
        return null;
    if (args.length > 1)
        return null; // `millwork help verifier` is not a command; let the usual grammar answer.
    return { exitCode: 0, stream: "stdout", text: topLevelHelpText() };
}
