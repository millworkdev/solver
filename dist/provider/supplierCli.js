import { basename } from 'node:path';
import { buildSupplierStatement, checkSupplierStatement } from './index.js';
import { SolverApiError } from "../errors.js";
import { ProviderSecretReplayUnavailableError, PROVIDER_SECRET_REPLAY_RECOVERY } from "./index.js";
import { mkdirSync, readFileSync, writeFileSync, rmSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { ProviderClient, checkProviderFeed, validateProviderProfile, validateProviderPortableContext, PROVIDER_FEED_SCHEMA, PROVIDER_INCUMBENT_FEED_SCHEMA, PROVIDER_PORTABLE_VALIDATION_CONTEXT_SCHEMA, PROVIDER_PROFILE_SCHEMA } from "./index.js";
const HELP = `Millwork supplier tools

  millwork supplier statement --help
  millwork supplier init --directory <new-directory>
  millwork supplier schema
  millwork supplier check --profile <profile.json> --feed <feed.json> --context <context.json> [--at <UTC>]
  millwork supplier profile
  millwork supplier context
  millwork supplier submit --feed <feed.json> --if-match <feed_etag> --yes
  millwork supplier source --file <source.json> --yes
  millwork supplier refresh --if-match <feed_etag> [--dry-run] --yes
  millwork supplier pulls
  millwork supplier domain challenge
  millwork supplier domain verify --challenge <id> --yes

init, schema and check run offline and require no API key. The sample uses reserved
example domains and a fixture model key; replace them with your own profile and
server-issued validation context before submitting. is_ready is optional (default true);
false reports a temporary readiness hold when lifecycle processing is enabled.
Validation checks metadata; it does not call your model endpoint, grant approval,
or make a route available to customers.

Online commands require MILLWORK_PROVIDER_API_KEY and MILLWORK_PROVIDER_API_URL
(the API URL includes /v1). Copy feed_etag from the profile read with your draft.
A stale refusal needs your explicit comparison and resubmission; no automatic retry.
Do not put provider credentials in these files, flags, or chat.
`;
function readJson(file) {
    const bytes = readFileSync(file);
    if (bytes.length > 262144)
        throw new Error("Input file exceeds 256 KiB.");
    return JSON.parse(bytes.toString("utf8"));
}
export async function runSupplierCli(args) {
    const command = args[0];
    if (command === 'statement') {
        await runStatementCli(args.slice(1));
        return;
    }
    if (!command || command === "help" || command === "--help" || command === "-h") {
        process.stdout.write(HELP);
        return;
    }
    const flag = (name, required = true) => {
        const position = args.indexOf(name);
        const value = position < 0 ? undefined : args[position + 1];
        if (value === undefined || value.startsWith("--")) {
            if (required)
                throw new Error(`Missing ${name}.`);
            return undefined;
        }
        return value;
    };
    const print = (value) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    if (command === "schema") {
        print({ feed: PROVIDER_FEED_SCHEMA, incumbent_feed: PROVIDER_INCUMBENT_FEED_SCHEMA, profile: PROVIDER_PROFILE_SCHEMA, validation_context: PROVIDER_PORTABLE_VALIDATION_CONTEXT_SCHEMA });
        return;
    }
    if (command === "init") {
        const directory = resolve(flag("--directory"));
        mkdirSync(directory); // Exclusive: never overwrite a developer's current feed.
        const owned = lstatSync(directory);
        try {
            const profile = { legal_entity: "Example Host Ltd", brand: "Example Host", domain: "app.example",
                source_id: "example-host", source_kind: "publisher_direct", support_url: "https://app.example", privacy_url: "https://app.example" };
            const feed = { schema_version: "provider-feed/v1", provider_source_id: profile.source_id,
                generated_at: new Date().toISOString(), routes: [{ route_id: "example-text-1", model_key: "example/release-1", model_id: "release-1",
                        origin: "https://app.example", path: "/v1/chat/completions", protocol: "openai_chat", region: "us-east-1",
                        data_classes: ["public"], capabilities: ["text_nonstream"], upstream_ref: null, fallback: false,
                        price: { currency: "USD", unit: "million_tokens", input: 0.1, output: 0.2, revision_sha256: "a".repeat(64) }, lifecycle: "active",
                        valid_until: new Date(Date.now() + 7 * 86400000).toISOString(), ownership_ref: profile.source_id }] };
            for (const [name, value] of Object.entries({ "profile.json": profile, "feed.json": feed, "context.json": { modelKeys: ["example/release-1"] } })) {
                writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
            }
            print({ directory, fixture_only: true, next_action: "check_offline_then_replace_fixture_identity" });
        }
        catch (error) {
            const current = lstatSync(directory, { throwIfNoEntry: false });
            if (current?.isDirectory() && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino)
                rmSync(directory, { recursive: true });
            throw error;
        }
        return;
    }
    if (command === "check") {
        const profile = readJson(flag("--profile"));
        if (!validateProviderProfile(profile))
            throw new Error("Profile is invalid or contains credential material.");
        const context = readJson(flag("--context"));
        if (!validateProviderPortableContext(context))
            throw new Error("Use the complete issued validation context JSON.");
        const at = args.includes("--at") ? flag("--at") : undefined;
        const now = at === undefined ? undefined : new Date(at);
        if (now !== undefined && !Number.isFinite(now.getTime()))
            throw new Error("--at must be a valid UTC timestamp.");
        const result = checkProviderFeed(readJson(flag("--feed")), { ...context, profile,
            ...(now === undefined ? {} : { now }) });
        print(result);
        if (result.result !== "validated")
            process.exitCode = 2;
        return;
    }
    if (!["profile", "context", "submit", "source", "refresh", "pulls", "domain"].includes(command))
        throw new Error("Unknown supplier command. Use millwork supplier --help.");
    const apiKey = process.env.MILLWORK_PROVIDER_API_KEY;
    const baseUrl = process.env.MILLWORK_PROVIDER_API_URL;
    if (!apiKey || !baseUrl)
        throw new Error("Online supplier commands require MILLWORK_PROVIDER_API_KEY and MILLWORK_PROVIDER_API_URL.");
    const client = new ProviderClient({ apiKey, baseUrl });
    const confirmed = () => { if (!args.includes("--yes"))
        throw new Error("Review the intended metadata change and pass --yes to confirm."); };
    switch (command) {
        case "profile":
            print(await client.profile());
            break;
        case "context":
            print(await client.validationContext());
            break;
        case "submit":
            confirmed();
            print(await client.submitFeed(readJson(flag("--feed")), flag("--if-match")));
            break;
        case "source":
            confirmed();
            print(await client.configureFeedSource(readJson(flag("--file"))));
            break;
        case "refresh":
            confirmed();
            print(await client.refreshFeed(flag("--if-match"), args.includes("--dry-run")));
            break;
        case "pulls":
            print(await client.feedPulls());
            break;
        case "domain":
            if (args[1] === "challenge")
                print(await client.domainChallenge());
            else if (args[1] === "verify") {
                confirmed();
                print(await client.verifyDomain(flag("--challenge")));
            }
            else
                throw new Error("Use supplier domain challenge or supplier domain verify.");
            break;
    }
}
const OFFER_HELP = `Millwork provider tools

  millwork offer workspace [--json]
  millwork offer check --profile <profile.json> --feed <feed.json> --context <context.json> [--at <UTC>] [--json]
  millwork offer check-online --feed <feed.json> --if-match <feed_etag> [--json]
  millwork offer deprecate <route-id> --revision <revision-id> --subject-sha256 <digest> --if-match <feed_etag> --yes [--json]
  millwork offer supply grants [--json]
  millwork offer supply requests [--cursor <request-id>] [--json]
  millwork offer supply request <request-id> [--json]
  millwork offer supply statements [--json]
  millwork offer supply statement <statement-id> [--json]

Plain check is offline and needs no key. Online commands use only
MILLWORK_PROVIDER_API_KEY and MILLWORK_PROVIDER_API_URL. Read workspace and compare
its current revision before an explicit write. Calls make one attempt with no
idempotency key; --yes confirms the deprecation intent, never grants approval from an owner or admin.
Withdrawal and privileged writes require a separate owner or admin approval surface.
Supply reads need a scoped key with supply:read. They print the archived grant,
request and statement view, including each request's accepted obligation and
current net payable. A missing id and a foreign id answer the same way.
They do not approve, commit, or pay. The existing millwork provider customer
commands and supplier tooling are unchanged.
`;
class OfferUsageError extends Error {
}
/** Resolve the whole grammar before credentials, files or HTTP are touched. */
export function parseOfferCommand(args) {
    const command = args[0] ?? "help";
    if (["help", "--help", "-h"].includes(command) && args.length <= 1)
        return { command: "help", flags: new Map() };
    if (command === "supply")
        return parseSupplyCommand(args);
    const allowed = {
        workspace: ["--json"],
        check: ["--profile", "--feed", "--context", "--at", "--json"],
        "check-online": ["--feed", "--if-match", "--json"],
        deprecate: ["--revision", "--subject-sha256", "--if-match", "--yes", "--json"],
    };
    if (!allowed[command])
        throw new OfferUsageError("Unknown offer command. Use millwork offer --help.");
    const flags = new Map();
    let position = 1;
    const routeId = command === "deprecate" ? args[position++] : undefined;
    if (command === "deprecate" && (!routeId || !/^[A-Za-z0-9_-]{1,200}$/.test(routeId)))
        throw new OfferUsageError("Deprecate requires an exact route id.");
    while (position < args.length) {
        const flag = args[position++];
        if (!allowed[command].includes(flag) || flags.has(flag))
            throw new OfferUsageError("Unsupported or repeated offer option. Use millwork offer --help.");
        if (flag === "--yes" || flag === "--json")
            flags.set(flag, true);
        else {
            const value = args[position++];
            if (!value || value.startsWith("--"))
                throw new OfferUsageError("An offer option needs its operand.");
            flags.set(flag, value);
        }
    }
    const required = command === "check" ? ["--profile", "--feed", "--context"]
        : command === "check-online" ? ["--feed", "--if-match"]
            : command === "deprecate" ? ["--revision", "--subject-sha256", "--if-match", "--yes"] : [];
    if (required.some(flag => !flags.has(flag)))
        throw new OfferUsageError("Missing offer options. Read millwork offer --help.");
    return { command, ...(routeId ? { routeId } : {}), flags };
}
function parseSupplyCommand(args) {
    const noun = args[1];
    if (!noun || !["grants", "requests", "request", "statements", "statement"].includes(noun)) {
        throw new OfferUsageError("Use millwork offer supply grants, requests, request <id>, statements, or statement <id>.");
    }
    let position = 2;
    let id;
    if (noun === "request" || noun === "statement") {
        id = args[position++];
        const maxLength = noun === "request" ? 200 : 265;
        if (!id || id.startsWith("--") || id.length > maxLength)
            throw new OfferUsageError("Supply request and statement reads need the server id.");
    }
    const flags = new Map();
    while (position < args.length) {
        const flag = args[position++];
        const allowed = noun === "requests" ? ["--cursor", "--json"] : ["--json"];
        if (!allowed.includes(flag) || flags.has(flag))
            throw new OfferUsageError("Unsupported or repeated offer option. Use millwork offer --help.");
        if (flag === "--json")
            flags.set(flag, true);
        else {
            const value = args[position++];
            if (!value || value.startsWith("--"))
                throw new OfferUsageError("An offer option needs its operand.");
            flags.set(flag, value);
        }
    }
    return { command: "supply", supply: { noun, ...(id ? { id } : {}) }, flags };
}
export async function runOfferCli(args) {
    const print = (value) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    try {
        const { command, routeId, supply, flags } = parseOfferCommand(args);
        if (command === "help") {
            process.stdout.write(OFFER_HELP);
            return;
        }
        if (command === "check") {
            await runSupplierCli(["check", ...args.slice(1).filter(flag => flag !== "--json")]);
            return;
        }
        const apiKey = process.env.MILLWORK_PROVIDER_API_KEY;
        const baseUrl = process.env.MILLWORK_PROVIDER_API_URL;
        if (!apiKey || !baseUrl)
            throw new OfferUsageError("Online offer commands require MILLWORK_PROVIDER_API_KEY and MILLWORK_PROVIDER_API_URL from your secret store.");
        const client = new ProviderClient({ apiKey, baseUrl });
        if (command === "supply") {
            const noun = supply.noun;
            const cursor = flags.get("--cursor");
            if (noun === "grants")
                print(await client.supplyGrants());
            else if (noun === "requests")
                print(await client.supplyRequests(typeof cursor === "string" ? cursor : undefined));
            else if (noun === "request")
                print(await client.supplyRequest(supply.id));
            else if (noun === "statements")
                print(await client.supplyStatements());
            else
                print(await client.supplyStatement(supply.id));
        }
        else if (command === "workspace")
            print(await client.workspace());
        else if (command === "check-online")
            print(await client.checkFeedOnline(readJson(String(flags.get("--feed"))), String(flags.get("--if-match"))));
        else
            print(await client.routeLifecycle(routeId, { revision_id: String(flags.get("--revision")),
                subject_sha256: String(flags.get("--subject-sha256")), lifecycle: "deprecated" }, String(flags.get("--if-match"))));
    }
    catch (error) {
        if (error instanceof OfferUsageError) {
            process.stderr.write(error.message + "\n");
            process.exitCode = 2;
            return;
        }
        // Never reflect an upstream body, private URL or provider credential in diagnostics.
        const replay = error instanceof ProviderSecretReplayUnavailableError;
        const code = error instanceof SolverApiError ? error.type.split("/").pop() : "provider_request_failed";
        const safeCode = code && /^[a-z_]+$/.test(code) ? code : "provider_request_failed";
        const detail = replay ? PROVIDER_SECRET_REPLAY_RECOVERY : "Read the current workspace and compare the request before explicitly trying again. No automatic resubmission was made.";
        if (args.includes("--json"))
            print({ error: safeCode, ...(error instanceof SolverApiError ? { status: error.status } : {}),
                next_action: { type: replay ? "list_or_revoke_then_mint_new_key" : "read_workspace_and_compare", detail } });
        else
            process.stderr.write(detail + "\n");
        process.exitCode = 1;
    }
}
const STATEMENT_HELP = `Millwork supplier statement tools

  millwork supplier statement build --file <statement.json> --out <new-canonical.json>
  millwork supplier statement check --file <canonical.json> --supplier <tenant-id> [--facts <archived-facts.json>]
  millwork supplier statement preflight --file <canonical.json> [--filename <retained-name>]
  millwork supplier statement commit --file <canonical.json> --preflight <sha256> [--approval <approval-id>] --yes [--filename <retained-name>]
  millwork supplier statement status --id <statement-id>

Build and check are offline. Supply the amounts and archived comparison facts yourself;
these commands never prefill them from Millwork reads. Build exclusively creates the
output file and never overwrites it. A pretty-printed submission fails canonical check.
Online commands use MILLWORK_PROVIDER_API_KEY and MILLWORK_PROVIDER_API_URL.
Scoped keys need the exact statement:read, statement:preflight or statement:commit scope.
First scoped commit requires separate owner or admin approval. --yes confirms submission only.
Retain document bytes, filename and preflight id for an explicit replay after a lost
response. Status is read-only. No automatic commit retry or payment occurs.
`;
export function parseStatementCommand(args) {
    const command = args[0] ?? 'help';
    if (['help', '--help', '-h'].includes(command) && args.length <= 1)
        return { command: 'help', flags: new Map() };
    const allowed = { build: ['--file', '--out'], check: ['--file', '--supplier', '--facts'], preflight: ['--file', '--filename'], commit: ['--file', '--filename', '--preflight', '--approval', '--yes'], status: ['--id'] };
    if (!allowed[command])
        throw new Error('Use supplier statement --help.');
    const flags = new Map();
    for (let i = 1; i < args.length; i++) {
        const flag = args[i];
        if (!allowed[command].includes(flag) || flags.has(flag))
            throw new Error('Unsupported or repeated statement option.');
        if (flag === '--yes')
            flags.set(flag, true);
        else {
            const value = args[++i];
            if (!value || value.startsWith('--'))
                throw new Error('Statement option needs an operand.');
            flags.set(flag, value);
        }
    }
    const required = command === 'build' ? ['--file', '--out'] : command === 'check' ? ['--file', '--supplier'] : command === 'commit' ? ['--file', '--preflight', '--yes'] : command === 'status' ? ['--id'] : ['--file'];
    if (required.some(flag => !flags.has(flag)))
        throw new Error('Missing statement options. Use supplier statement --help.');
    if (flags.has('--preflight') && !/^[a-f0-9]{64}$/.test(String(flags.get('--preflight'))))
        throw new Error('Use the reviewed preflight id.');
    if (flags.has('--approval') && !/^maa_[A-Za-z0-9]+$/.test(String(flags.get('--approval'))))
        throw new Error('Use a separate owner or admin approval reference.');
    return { command, flags };
}
function raw(file) { const bytes = readFileSync(file); if (bytes.length > 65536)
    throw new Error('Statement file exceeds 64 KiB.'); return bytes.toString('utf8'); }
export async function runStatementCli(args) {
    try {
        const { command, flags } = parseStatementCommand(args);
        if (command === 'help') {
            process.stdout.write(STATEMENT_HELP);
            return;
        }
        const text = (flag) => String(flags.get(flag));
        const print = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
        if (command === 'build') {
            const document = buildSupplierStatement(JSON.parse(raw(text('--file'))));
            writeFileSync(text('--out'), document.raw_document, { flag: 'wx', mode: 0o600 });
            print({ created: text('--out'), authority: 'offline_build_only' });
            return;
        }
        if (command === 'check') {
            const result = checkSupplierStatement({ raw_document: raw(text('--file')), media_type: 'application/json' }, text('--supplier'), flags.has('--facts') ? JSON.parse(raw(text('--facts'))) : {});
            print(result);
            if (result.result !== 'validated')
                process.exitCode = 2;
            return;
        }
        const apiKey = process.env.MILLWORK_PROVIDER_API_KEY, baseUrl = process.env.MILLWORK_PROVIDER_API_URL;
        if (!apiKey || !baseUrl)
            throw new Error('Online statements need the configured provider API key and URL.');
        const client = new ProviderClient({ apiKey, baseUrl });
        if (command === 'status') {
            print(await client.statementStatus(text('--id')));
            return;
        }
        const document = { raw_document: raw(text('--file')), media_type: 'application/json', filename: flags.has('--filename') ? text('--filename') : basename(text('--file')) };
        if (command === 'preflight')
            print(await client.statementPreflight(document));
        else {
            print(await client.statementCommit(document, text('--preflight'), flags.has('--approval') ? text('--approval') : undefined));
        }
    }
    catch (error) {
        // No raw statement, private URL, key or server error body enters diagnostics.
        const code = error instanceof SolverApiError ? error.type.split('/').pop() : 'statement_command_failed';
        process.stderr.write((code && /^[a-z_]+$/.test(code) ? code : 'statement_command_failed') + ': read supplier statement --help; preserve the reviewed bytes before an explicit retry.\n');
        process.exitCode = error instanceof SolverApiError ? 1 : 2;
    }
}
