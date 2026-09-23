import { readFileSync } from "node:fs";
/**
 * Offline discovery for the verifier surface: what this installed CLI can do
 * with an output check, which flags each command really takes, which values
 * each command-local choice really accepts, and what each command costs in
 * network calls, credentials and money.
 *
 * It answers from the installed package alone. No repository, no account key,
 * no network call -- an agent that has just installed the CLI can read this
 * and know what it is allowed to try next, instead of guessing from a usage
 * line or from documentation that may describe a different version.
 *
 * The flag tables below are not a description of the parser. They ARE the
 * parser's tables: cli.ts and cliVerifierKit.ts validate arguments against
 * these exact sets, so a flag this document reports is a flag the CLI accepts
 * by construction, and a flag the CLI accepts cannot be missing from here.
 */
export const VERIFIER_CAPABILITIES_VERSION = "millwork.verifier-capabilities.v1";
/** The dock contract this CLI's kit and local tests are written against. */
export const VERIFIER_DOCK_CONTRACT = {
    contract_id: "millwork.verifier-dock.v1",
    contract_version: "1.0.0",
    url: "https://docs.getmillwork.dev/contracts/verifier-dock/v1.json",
};
/**
 * The two access vocabularies are deliberately separate words for separate
 * questions, and merging them would be a customer-visible change, not a
 * tidy-up. Local: what the adapter under test expects from its caller, in a
 * process that never contacts Millwork. Remote: who holds the endpoint's key
 * for a real connection.
 */
export const LOCAL_ACCESS_MODES = ["public", "authenticated"];
export const REMOTE_ACCESS_MODES = ["public", "managed"];
/** The recipe overlays `verifier init` can select. */
export const VERIFIER_RECIPE_CHOICES = ["default", "0", "a", "b", "c", "d"];
const JSON_FLAG = "--json";
const verifierCommands = [
    {
        command: "verifier capabilities",
        summary: "Print this document. Offline discovery of the installed verifier surface.",
        booleanFlags: [JSON_FLAG],
        valueFlags: [],
        network: "none",
        credential: "none",
        spend: "none",
    },
    {
        command: "verifier init",
        summary: "Write the maintained output-check kit into a directory, with one recipe selected.",
        booleanFlags: [JSON_FLAG],
        valueFlags: ["--directory", "--recipe"],
        enums: { "--recipe": VERIFIER_RECIPE_CHOICES },
        network: "none",
        credential: "none",
        spend: "none",
    },
    {
        command: "verifier test --local",
        summary: "Run the compatibility kit against a local check module, in process. Proves contract, access and timing; never correctness.",
        booleanFlags: [JSON_FLAG, "--local"],
        valueFlags: ["--check", "--access"],
        enums: { "--access": LOCAL_ACCESS_MODES },
        network: "none",
        credential: "none",
        spend: "none",
    },
    {
        command: "verifier attach",
        summary: "Register an endpoint whose credential is already held by a broker handle.",
        booleanFlags: [JSON_FLAG, "--yes", "--declare-deterministic"],
        valueFlags: ["--name", "--version", "--endpoint", "--auth-ref", "--data-class", "--idempotency-key"],
        network: "millwork_api",
        credential: "millwork_account_key",
        spend: "none",
    },
    {
        command: "verifier connect",
        summary: "Connect an endpoint: public with no key, or managed with a key Millwork holds. Can continue into a first governed run.",
        booleanFlags: [JSON_FLAG, "--yes", "--connect-only", "--declare-deterministic", "--open-browser", "--no-browser"],
        valueFlags: [
            "--verifier-id", "--endpoint", "--name", "--version", "--data-class", "--stop-days", "--stop-date",
            "--time-zone", "--idempotency-key", "--intent-id", "--access", "--objective", "--preset", "--arm-id",
            "--max-cost-usd", "--max-runtime-s",
        ],
        enums: { "--access": REMOTE_ACCESS_MODES },
        network: "millwork_api",
        credential: "millwork_account_key",
        spend: "run_authorization_required",
        spendNote: "Connecting costs nothing. Passing --objective continues into a governed run, which is priced and separately authorized. Pass --connect-only to stop after connecting.",
    },
    {
        command: "verifier list",
        summary: "List the verifiers on this account.",
        booleanFlags: [JSON_FLAG],
        valueFlags: ["--cursor", "--limit"],
        network: "millwork_api",
        credential: "millwork_account_key",
        spend: "none",
    },
    {
        command: "verifier show",
        summary: "Read one verifier and its connection state.",
        booleanFlags: [JSON_FLAG],
        valueFlags: ["--verifier-id"],
        network: "millwork_api",
        credential: "millwork_account_key",
        spend: "none",
    },
    {
        command: "verifier test",
        summary: "Retest a connected endpoint from Millwork. Without --local this is a real call to your deployed dock.",
        booleanFlags: [JSON_FLAG],
        valueFlags: ["--verifier-id", "--idempotency-key"],
        network: "millwork_api",
        credential: "millwork_account_key",
        spend: "none",
    },
    ...["replace", "restore", "continue", "disconnect"].map((lifecycle) => ({
        command: `verifier ${lifecycle}`,
        summary: lifecycleSummary(lifecycle),
        booleanFlags: [JSON_FLAG, "--yes", "--open-browser", "--no-browser"],
        valueFlags: [
            "--verifier-id", "--idempotency-key", "--intent-id", "--operation-key", "--handle",
            "--stop-days", "--stop-date", "--time-zone",
        ],
        network: "millwork_api",
        credential: "millwork_account_key",
        spend: "none",
    })),
];
export const VERIFIER_COMMANDS = Object.freeze(verifierCommands);
function lifecycleSummary(command) {
    if (command === "replace")
        return "Stage a new endpoint key and promote it only after it tests. A failed replacement leaves the working key untouched.";
    if (command === "restore")
        return "Re-enter a key for a revoked or expired connection.";
    if (command === "continue")
        return "Resume an entry that was started but not finished.";
    return "Stop Millwork using this endpoint's key. Revoke the key at your endpoint as well.";
}
/** Lookup used by the argument parsers, so the table above is the parser's. */
export function verifierCommandCapability(command) {
    return VERIFIER_COMMANDS.find((entry) => entry.command === command);
}
/** The flag sets for one command, in the shape assertCommandFlags takes. */
export function verifierCommandFlagSets(command) {
    const capability = verifierCommandCapability(command);
    if (!capability)
        throw new Error(`no capability entry for ${command}`);
    return { booleans: new Set(capability.booleanFlags), values: new Set(capability.valueFlags) };
}
function packageIdentity() {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (manifest.name !== "@millwork/solver" || typeof manifest.version !== "string") {
        throw new Error("the CLI package identity is invalid");
    }
    return { name: manifest.name, version: manifest.version };
}
export function buildVerifierCapabilities() {
    return {
        schema_version: VERIFIER_CAPABILITIES_VERSION,
        command: "millwork verifier capabilities",
        package: packageIdentity(),
        discovery: {
            offline: true,
            network_calls: 0,
            account_key_required: false,
            detail: "This document is built from the installed package. It reports what this CLI accepts, not what the service currently offers.",
        },
        dock_contract: VERIFIER_DOCK_CONTRACT,
        access_vocabularies: {
            local_test: { flag: "--access", command: "verifier test --local", values: LOCAL_ACCESS_MODES,
                meaning: "What the adapter under test expects from its caller. This runs in process and never contacts Millwork." },
            remote_connection: { flag: "--access", command: "verifier connect", values: REMOTE_ACCESS_MODES,
                meaning: "Who holds the endpoint's key for a real connection: nobody (public) or Millwork (managed)." },
            note: "The two vocabularies answer different questions and are not synonyms. authenticated is not managed.",
        },
        commands: VERIFIER_COMMANDS.map((entry) => ({
            command: `millwork ${entry.command}`,
            summary: entry.summary,
            boolean_flags: entry.booleanFlags,
            value_flags: entry.valueFlags,
            ...(entry.enums ? { enum_values: entry.enums } : {}),
            network: entry.network,
            credential: entry.credential,
            spend: entry.spend,
            ...(entry.spendNote ? { spend_note: entry.spendNote } : {}),
        })),
        boundaries: {
            keys_as_arguments: "refused",
            keys_as_arguments_detail: "No command accepts an endpoint key or an account key as an argument. An endpoint key is entered by the person on a private page; the account key comes from the environment.",
            offline_commands: VERIFIER_COMMANDS.filter((entry) => entry.network === "none").map((entry) => `millwork ${entry.command}`),
            spending_commands: VERIFIER_COMMANDS.filter((entry) => entry.spend !== "none").map((entry) => `millwork ${entry.command}`),
        },
        next_action: "millwork verifier init --recipe 0 --json",
    };
}
/** `millwork verifier capabilities [--json]`, resolved before anything that
 *  would need a key. Human and JSON forms carry the same facts. */
export function resolveVerifierCapabilitiesCommand(args) {
    if (args[0] !== "verifier" || args[1] !== "capabilities")
        return null;
    const remainder = args.slice(2);
    if (remainder.length > 1 || (remainder.length === 1 && remainder[0] !== JSON_FLAG)) {
        return {
            exitCode: 2,
            stream: "stderr",
            text: JSON.stringify({ schema_version: 1, error: "invalid_arguments", usage: "millwork verifier capabilities [--json]" }, null, 2),
        };
    }
    const document = buildVerifierCapabilities();
    if (remainder[0] === JSON_FLAG) {
        return { exitCode: 0, stream: "stdout", text: JSON.stringify(document, null, 2) };
    }
    return { exitCode: 0, stream: "stdout", text: renderVerifierCapabilities(document) };
}
function renderVerifierCapabilities(document) {
    const identity = document.package;
    const lines = [
        `${identity.name} ${identity.version} -- verifier commands this install accepts.`,
        "Read offline. No account key, no network call.",
        "",
    ];
    for (const entry of document.commands) {
        lines.push(`${entry.command}`);
        lines.push(`  ${entry.summary}`);
        const flags = [...entry.boolean_flags, ...entry.value_flags];
        if (flags.length > 0)
            lines.push(`  flags: ${flags.join(" ")}`);
        for (const [flag, values] of Object.entries((entry.enum_values ?? {}))) {
            lines.push(`  ${flag}: ${values.join(" | ")}`);
        }
        lines.push(`  network: ${entry.network}   credential: ${entry.credential}   spend: ${entry.spend}`);
        if (entry.spend_note)
            lines.push(`  ${entry.spend_note}`);
        lines.push("");
    }
    lines.push(`Dock contract: ${VERIFIER_DOCK_CONTRACT.url}`);
    lines.push(`Next: ${document.next_action}`);
    return lines.join("\n");
}
