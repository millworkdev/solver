import type { CliDiscoveryResult } from "./cliDiscovery.js";
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
export declare const USAGE_LINE = "usage: millwork <docs|doctor|--version|models list|models use <catalog-model>|models add <catalog-model>|arms disable <arm-id>|run --preset <id> --objective <task>|provider list|provider connect <source-id>|provider rotate <connection-id>|provider disconnect <connection-id>|verifier capabilities|verifier attach --endpoint <url> --auth-ref <handle>|verifier connect --endpoint <url> --access public|managed|verifier init|verifier test --local|verifier list|verifier show|verifier test|verifier <replace|restore|continue|disconnect> --verifier-id <id>|tenant show|tenant start> [options]";
export declare function topLevelHelpText(): string;
/** Resolved before anything that could read a key or reach the network. */
export declare function resolveTopLevelHelp(args: string[]): CliDiscoveryResult | null;
