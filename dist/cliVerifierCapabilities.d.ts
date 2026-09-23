import type { CliDiscoveryResult } from "./cliDiscovery.js";
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
export declare const VERIFIER_CAPABILITIES_VERSION = "millwork.verifier-capabilities.v1";
/** The dock contract this CLI's kit and local tests are written against. */
export declare const VERIFIER_DOCK_CONTRACT: {
    readonly contract_id: "millwork.verifier-dock.v1";
    readonly contract_version: "1.0.0";
    readonly url: "https://docs.getmillwork.dev/contracts/verifier-dock/v1.json";
};
/**
 * The two access vocabularies are deliberately separate words for separate
 * questions, and merging them would be a customer-visible change, not a
 * tidy-up. Local: what the adapter under test expects from its caller, in a
 * process that never contacts Millwork. Remote: who holds the endpoint's key
 * for a real connection.
 */
export declare const LOCAL_ACCESS_MODES: readonly ["public", "authenticated"];
export declare const REMOTE_ACCESS_MODES: readonly ["public", "managed"];
/** The recipe overlays `verifier init` can select. */
export declare const VERIFIER_RECIPE_CHOICES: readonly ["default", "0", "a", "b", "c", "d"];
export interface VerifierCommandCapability {
    /** As a reader types it, without the `millwork` prefix. */
    command: string;
    summary: string;
    /** Flags taking no value. */
    booleanFlags: readonly string[];
    /** Flags that must be followed by a value. */
    valueFlags: readonly string[];
    /** Command-local choices: the exact values a flag accepts here. */
    enums?: Readonly<Record<string, readonly string[]>>;
    network: "none" | "millwork_api";
    credential: "none" | "millwork_account_key";
    spend: "none" | "run_authorization_required";
    /** Present when the command can lead somewhere that costs money. */
    spendNote?: string;
}
export declare const VERIFIER_COMMANDS: readonly VerifierCommandCapability[];
/** Lookup used by the argument parsers, so the table above is the parser's. */
export declare function verifierCommandCapability(command: string): VerifierCommandCapability | undefined;
/** The flag sets for one command, in the shape assertCommandFlags takes. */
export declare function verifierCommandFlagSets(command: string): {
    booleans: Set<string>;
    values: Set<string>;
};
export declare function buildVerifierCapabilities(): Record<string, unknown>;
/** `millwork verifier capabilities [--json]`, resolved before anything that
 *  would need a key. Human and JSON forms carry the same facts. */
export declare function resolveVerifierCapabilitiesCommand(args: string[]): CliDiscoveryResult | null;
