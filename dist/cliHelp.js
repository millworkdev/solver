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
export const USAGE_LINE = "usage: millwork <docs|doctor|--version|models list|models use <catalog-model>|models add <catalog-model>|arms disable <arm-id>|run --preset <id> --objective <task>|provider list|provider connect <source-id>|provider rotate <connection-id>|provider disconnect <connection-id>|verifier capabilities|verifier attach --endpoint <url> --auth-ref <handle>|verifier connect --endpoint <url> --access public|managed|verifier init|verifier test --local|verifier list|verifier show|verifier test|verifier <replace|restore|continue|disconnect> --verifier-id <id>|tenant show|tenant start> [options]";
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
