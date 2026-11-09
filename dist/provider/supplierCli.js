import { basename } from 'node:path';
import { buildSupplierStatement, checkSupplierStatement } from './index.js';
import { SolverApiError } from "../errors.js";
import { ProviderSecretReplayUnavailableError, PROVIDER_SECRET_REPLAY_RECOVERY } from "./index.js";
import { closeSync, constants, fchmodSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";
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
  millwork offer login --client <name> [--scopes <scope,scope>] [--days 1|7|30 (default 30)] [--json]
  millwork offer logout

Plain check is offline and needs no key. Login stores a key for this user in
the OS credential store for the API address used at login. It prints the
granted scopes and does not print, log, or return the key. Logout revokes that
key and removes it from this computer. When no OS store
exists, login warns and uses a local file. The approval page signs the CLI in
as you and lists the scopes your access includes; its address does not contain
the key. When --days is omitted, the login requests 30 days.
1, 7, and 30 stay available, and the approval link still expires
in 10 minutes. Other online commands use MILLWORK_PROVIDER_API_KEY
when it is set, otherwise the stored key for that same API address, and
MILLWORK_PROVIDER_API_URL. Read workspace and compare
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
    if (command === "login")
        return parseLoginCommand(args);
    if (command === "logout") {
        if (args.length > 1)
            throw new OfferUsageError("Unsupported or repeated offer option. Use millwork offer --help.");
        return { command: "logout", flags: new Map() };
    }
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
const LOGIN_SCOPES = ["provider:read", "provider:feed", "supply:read", "statement:read", "statement:preflight", "statement:commit"];
function parseLoginCommand(args) {
    const flags = new Map();
    let position = 1;
    while (position < args.length) {
        const flag = args[position++];
        if (!["--client", "--scopes", "--days", "--json"].includes(flag) || flags.has(flag))
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
    const client = flags.get("--client");
    if (typeof client !== "string" || client.length < 1 || client.length > 100 || /[\u0000-\u001f]/.test(client) || client.includes("solverapi_")) {
        throw new OfferUsageError("Login needs a client name, which is a label and not a credential.");
    }
    const days = flags.get("--days") ?? "30";
    if (days !== "1" && days !== "7" && days !== "30")
        throw new OfferUsageError("Login lifetime must be 1, 7, or 30 days.");
    const scopes = typeof flags.get("--scopes") === "string" ? String(flags.get("--scopes")).split(",") : ["provider:read", "provider:feed"];
    if (scopes.length < 1 || scopes.length > 6 || new Set(scopes).size !== scopes.length || scopes.some(scope => !LOGIN_SCOPES.includes(scope))) {
        throw new OfferUsageError("Login scopes must be provider scopes.");
    }
    if (scopes.some(scope => scope.startsWith("statement:")))
        throw new OfferUsageError("Statement scopes are not available on provider login.");
    return { command: "login", flags };
}
export function createLoginPkce() {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
export function providerKeyFile() {
    return process.env.MILLWORK_PROVIDER_KEY_FILE || join(homedir(), ".millwork", "provider-key");
}
const PROVIDER_KEY_PATTERN = /^solverapi_(?:scoped|user)_[A-Za-z0-9_-]+$/;
function acceptableProviderKey(key) {
    return PROVIDER_KEY_PATTERN.test(key);
}
function packStoredCredential(key, apiBase) {
    return `v1|${encodeURIComponent(apiBase)}|${key}`;
}
function unpackStoredCredential(raw, apiBase) {
    const match = /^v1\|([^|]*)\|(solverapi_(?:scoped|user)_[A-Za-z0-9_-]+)$/.exec(raw.trim());
    if (!match || !acceptableProviderKey(match[2]))
        return undefined;
    try {
        if (decodeURIComponent(match[1]) !== apiBase)
            return undefined;
    }
    catch {
        return undefined;
    }
    return match[2];
}
export function osCredentialStore(kind) {
    if (kind === "darwin")
        return macCredentialStore();
    if (kind === "linux")
        return linuxCredentialStore();
    return windowsCredentialStore();
}
function commandExists(command) {
    const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
    return result.status === 0;
}
function detectOsCredentialStore() {
    if (process.platform === "darwin" && commandExists("security"))
        return macCredentialStore();
    if (process.platform === "linux" && commandExists("secret-tool"))
        return linuxCredentialStore();
    if (process.platform === "win32" && commandExists("powershell.exe"))
        return windowsCredentialStore();
    return { available: false, write() { throw new OfferUsageError("The provider key could not be stored."); }, read: () => undefined };
}
function macCredentialStore() {
    return { available: true,
        write(key) {
            const result = spawnSync("security", ["-i"], { input: `add-generic-password -U -s millwork-provider-key -a millwork -w ${key}\n`, timeout: 10000, stdio: ["pipe", "ignore", "ignore"] });
            if (result.status !== 0)
                throw new OfferUsageError("The provider key could not be stored.");
        },
        read() {
            const result = spawnSync("security", ["find-generic-password", "-s", "millwork-provider-key", "-a", "millwork", "-w"], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] });
            const value = result.status === 0 ? result.stdout.trim() : "";
            return value.length > 0 ? value : undefined;
        },
        delete() {
            const result = spawnSync("security", ["delete-generic-password", "-s", "millwork-provider-key", "-a", "millwork"], { timeout: 10000, stdio: ["ignore", "ignore", "ignore"] });
            if (result.status !== 0)
                throw new OfferUsageError("The provider key could not be removed.");
        } };
}
function linuxCredentialStore() {
    const args = ["service", "millwork-provider-key", "account", "millwork"];
    return { available: true,
        write(key) {
            const result = spawnSync("secret-tool", ["store", "--label=Millwork provider key", ...args], { input: key, timeout: 10000, stdio: ["pipe", "ignore", "ignore"] });
            if (result.status !== 0)
                throw new OfferUsageError("The provider key could not be stored.");
        },
        read() {
            const result = spawnSync("secret-tool", ["lookup", ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] });
            const value = result.status === 0 ? result.stdout.trim() : "";
            return value.length > 0 ? value : undefined;
        },
        delete() {
            const result = spawnSync("secret-tool", ["clear", ...args], { timeout: 10000, stdio: ["ignore", "ignore", "ignore"] });
            if (result.status !== 0)
                throw new OfferUsageError("The provider key could not be removed.");
        } };
}
function windowsCredentialStore() {
    const run = (script) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { input: script, encoding: "utf8", timeout: 10000, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    return { available: true,
        write(key) {
            const result = run(`$secret = @'\n${key}\n'@\n` + WINDOWS_WRITE);
            if (result.status !== 0)
                throw new OfferUsageError("The provider key could not be stored.");
        },
        read() {
            const result = run(WINDOWS_READ);
            const value = result.status === 0 ? result.stdout.trim() : "";
            return value.length > 0 ? value : undefined;
        },
        delete() {
            const result = run(WINDOWS_DELETE);
            if (result.status !== 0)
                throw new OfferUsageError("The provider key could not be removed.");
        } };
}
const WINDOWS_DELETE = `Add-Type -Namespace Millwork -Name CredDelete -MemberDefinition @'
using System; using System.Runtime.InteropServices;
public class Native { [DllImport("advapi32", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool CredDelete(string target, uint type, uint flags); }
'@
if (-not [Millwork.CredDelete+Native]::CredDelete('millwork-provider-key', 1, 0)) { exit 1 }`;
const WINDOWS_WRITE = `$bytes = [Text.Encoding]::UTF8.GetBytes($secret)
Add-Type -Namespace Millwork -Name CredWrite -MemberDefinition @'
using System; using System.Runtime.InteropServices;
public class Native { [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
[DllImport("advapi32", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool CredWrite(ref CREDENTIAL userCredential, uint flags); }
'@
$ptr = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
[Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
$cred = New-Object Millwork.CredWrite+Native+CREDENTIAL
$cred.Type = 1; $cred.TargetName = 'millwork-provider-key'; $cred.CredentialBlobSize = [uint32]$bytes.Length; $cred.CredentialBlob = $ptr; $cred.Persist = 2; $cred.UserName = 'millwork'
$ok = [Millwork.CredWrite+Native]::CredWrite([ref]$cred, 0)
[Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
if (-not $ok) { exit 1 }`;
const WINDOWS_READ = `Add-Type -Namespace Millwork -Name CredRead -MemberDefinition @'
using System; using System.Runtime.InteropServices;
public class Native { [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
[DllImport("advapi32", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credential); [DllImport("advapi32")] public static extern void CredFree(IntPtr cred); }
'@
$ptr = [IntPtr]::Zero
if (-not [Millwork.CredRead+Native]::CredRead('millwork-provider-key', 1, 0, [ref]$ptr)) { exit 1 }
$cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][Millwork.CredRead+Native+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $bytes.Length)
[Millwork.CredRead+Native]::CredFree($ptr)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))`;
export function storeProviderKey(key, filePath, apiBase) {
    if (!acceptableProviderKey(key) || apiBase.length < 1 || /[\r\n|]/.test(apiBase))
        throw new OfferUsageError("The provider key could not be stored.");
    const directory = dirname(filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink())
        throw new OfferUsageError("The provider key could not be stored.");
    refuseCredentialSymlink(filePath);
    const temporary = join(directory, `.provider-key.${randomBytes(8).toString("hex")}`);
    const descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
        fchmodSync(descriptor, 0o600);
        writeSync(descriptor, `${packStoredCredential(key, apiBase)}\n`);
    }
    finally {
        closeSync(descriptor);
    }
    try {
        refuseCredentialSymlink(filePath);
    }
    catch (error) {
        rmSync(temporary, { force: true });
        throw error;
    }
    renameSync(temporary, filePath);
}
function refuseCredentialSymlink(filePath) {
    try {
        if (lstatSync(filePath).isSymbolicLink())
            throw new OfferUsageError("The provider key could not be stored.");
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
}
export function readStoredProviderKey(filePath = providerKeyFile(), apiBase) {
    try {
        const descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            const value = readFileSync(descriptor, "utf8");
            return apiBase === undefined ? (acceptableProviderKey(value.trim()) ? value.trim() : undefined) : unpackStoredCredential(value, apiBase);
        }
        finally {
            closeSync(descriptor);
        }
    }
    catch {
        return undefined;
    }
}
export function storeProviderCredential(key, options) {
    if (!acceptableProviderKey(key) || options.apiBase.length < 1 || /[\r\n|]/.test(options.apiBase))
        throw new OfferUsageError("The provider key could not be stored.");
    const packed = packStoredCredential(key, options.apiBase);
    const store = options.osStore ?? detectOsCredentialStore();
    if (store.available) {
        store.write(packed);
        return;
    }
    storeProviderKey(key, options.filePath ?? providerKeyFile(), options.apiBase);
}
export function readProviderCredential(filePath = providerKeyFile(), osStore = detectOsCredentialStore(), apiBase = process.env.MILLWORK_PROVIDER_API_URL) {
    if (!apiBase)
        return undefined;
    return unpackStoredCredential(readPackedCredential(filePath, osStore) ?? "", apiBase);
}
function readPackedCredential(filePath, osStore) {
    if (osStore.available)
        return osStore.read();
    try {
        const descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            return readFileSync(descriptor, "utf8");
        }
        finally {
            closeSync(descriptor);
        }
    }
    catch {
        return undefined;
    }
}
function forgetStoredCredential(filePath, osStore) {
    if (osStore.available) {
        if (!osStore.delete)
            throw new OfferUsageError("The provider key could not be removed.");
        osStore.delete();
        return;
    }
    rmSync(filePath, { force: true });
}
export async function runProviderLogout(options = {}) {
    const stdout = options.stdout ?? (chunk => { process.stdout.write(chunk); });
    const stderr = options.stderr ?? (chunk => { process.stderr.write(chunk); });
    const apiUrl = options.apiUrl ?? process.env.MILLWORK_PROVIDER_API_URL;
    if (!apiUrl)
        throw new OfferUsageError("Provider logout needs MILLWORK_PROVIDER_API_URL.");
    const filePath = options.keyFile ?? providerKeyFile();
    const osStore = options.osStore ?? detectOsCredentialStore();
    const key = readProviderCredential(filePath, osStore, apiUrl);
    if (!key) {
        stderr("No provider key is stored for this API address.\n");
        return;
    }
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const revoked = await fetchImpl(new URL("/v1/providers/login-credentials/current/revoke", apiUrl), {
        method: "POST", headers: {
            authorization: `Bearer ${key}`, accept: "application/json", "content-type": "application/json",
            "idempotency-key": randomBytes(16).toString("hex"),
        },
        body: "{}",
    });
    if (!revoked.ok)
        throw new OfferUsageError("The provider key could not be revoked.");
    forgetStoredCredential(filePath, osStore);
    stdout("Revoked the provider key for this user and removed it from this computer. It was not printed.\n");
}
function storedCredentialBase(filePath, osStore) {
    const match = /^v1\|([^|]*)\|solverapi_(?:scoped|user)_[A-Za-z0-9_-]+$/.exec((readPackedCredential(filePath, osStore) ?? "").trim());
    if (!match)
        return undefined;
    try {
        return decodeURIComponent(match[1]);
    }
    catch {
        return undefined;
    }
}
function waitForLoginCode(timeoutMs) {
    const state = randomBytes(16).toString("base64url");
    return new Promise((resolve, reject) => {
        let resolveCode = () => undefined;
        let rejectCode = () => undefined;
        const code = new Promise((resolveResult, rejectResult) => { resolveCode = resolveResult; rejectCode = rejectResult; });
        code.catch(() => undefined);
        let settled = false;
        let timer = setTimeout(() => undefined, timeoutMs);
        const finish = (action) => { if (settled)
            return; settled = true; clearTimeout(timer); action(); };
        const fail = (message) => finish(() => rejectCode(new OfferUsageError(message)));
        const server = createServer((request, response) => {
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            const callbackCode = url.searchParams.get("code");
            const presented = url.searchParams.get("state") ?? "";
            const stateMatches = presented.length === state.length && timingSafeEqual(Buffer.from(presented), Buffer.from(state));
            if (request.method !== "GET" || url.pathname !== "/callback" || !callbackCode || !stateMatches) {
                response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
                response.end("This login callback is incomplete.");
                return;
            }
            response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            response.end("<!doctype html><title>Provider login</title><p>Login approved. You can close this window.</p>");
            finish(() => resolveCode(callbackCode));
        });
        clearTimeout(timer);
        timer = setTimeout(() => {
            server.close();
            fail("The approval window ended before the login finished.");
        }, timeoutMs);
        const close = () => new Promise(done => {
            fail("The provider login did not start.");
            server.close(() => done());
        });
        server.on("error", () => { fail("The local login callback could not start."); reject(new OfferUsageError("The local login callback could not start.")); });
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                fail("The local login callback could not start.");
                reject(new OfferUsageError("The local login callback could not start."));
                return;
            }
            resolve({ redirectUri: `http://127.0.0.1:${address.port}/callback?state=${encodeURIComponent(state)}`, code, close });
        });
    });
}
export async function runProviderLogin(flags, options = {}) {
    const stdout = options.stdout ?? (chunk => { process.stdout.write(chunk); });
    const stderr = options.stderr ?? (chunk => { process.stderr.write(chunk); });
    const apiUrl = options.apiUrl ?? process.env.MILLWORK_PROVIDER_API_URL;
    const dashboardUrl = options.dashboardUrl ?? process.env.MILLWORK_PROVIDER_DASHBOARD_URL;
    if (!apiUrl || !dashboardUrl)
        throw new OfferUsageError("Provider login needs MILLWORK_PROVIDER_API_URL and MILLWORK_PROVIDER_DASHBOARD_URL.");
    const days = Number(flags.get("--days") ?? "30");
    const scopes = typeof flags.get("--scopes") === "string" ? String(flags.get("--scopes")).split(",") : ["provider:read", "provider:feed"];
    const { verifier, challenge } = createLoginPkce();
    const listener = await waitForLoginCode(options.timeoutMs ?? 10 * 60 * 1000);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const filePath = options.keyFile ?? providerKeyFile();
    const osStore = options.osStore ?? detectOsCredentialStore();
    try {
        const started = await fetchImpl(new URL("/v1/providers/login-handoffs", apiUrl), { method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ client_name: flags.get("--client"), code_challenge: challenge, scopes, expires_in_days: days, redirect_uri: listener.redirectUri }) });
        if (!started.ok)
            throw new OfferUsageError("The provider login did not start.");
        const start = await started.json();
        if (!start.handoff_id || !start.approval_path?.startsWith("/provider/handoff/"))
            throw new OfferUsageError("The provider login did not start.");
        const approvalUrl = new URL(start.approval_path, dashboardUrl).toString();
        if (approvalUrl.includes("solverapi_") || approvalUrl.includes("code="))
            throw new OfferUsageError("The provider login did not start.");
        stderr(`Open this page and approve the client, scopes, and lifetime:\n${approvalUrl}\n`);
        const callbackCode = await listener.code;
        const exchanged = await fetchImpl(new URL(`/v1/providers/login-handoffs/${encodeURIComponent(start.handoff_id)}/exchange`, apiUrl), {
            method: "POST", headers: { "content-type": "application/json", accept: "application/json", "idempotency-key": randomBytes(16).toString("hex") },
            body: JSON.stringify({ code: callbackCode, code_verifier: verifier })
        });
        if (!exchanged.ok)
            throw new OfferUsageError("The provider login did not finish. Start it again. A finished login does not reveal the key a second time.");
        const payload = await exchanged.json();
        if (typeof payload.key !== "string")
            throw new OfferUsageError("The provider login did not finish. Start it again. A finished login does not reveal the key a second time.");
        const granted = Array.isArray(payload.scopes) ? payload.scopes.filter((scope) => typeof scope === "string") : [];
        if (!osStore.available)
            stderr(`No OS credential store is available. The provider key was stored in ${filePath}.\n`);
        storeProviderCredential(payload.key, { filePath, osStore, apiBase: apiUrl });
        stdout(flags.has("--json")
            ? `${JSON.stringify({ stored: true, scopes: granted }, null, 2)}\n`
            : `Stored the provider key for this user. Granted scopes: ${granted.join(", ") || "none"}. It was not printed.\n`);
    }
    finally {
        await listener.close();
    }
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
        if (command === "login") {
            await runProviderLogin(flags);
            return;
        }
        if (command === "logout") {
            await runProviderLogout();
            return;
        }
        const baseUrl = process.env.MILLWORK_PROVIDER_API_URL;
        const apiKey = process.env.MILLWORK_PROVIDER_API_KEY ?? (baseUrl ? readProviderCredential(providerKeyFile(), detectOsCredentialStore(), baseUrl) : undefined);
        if (!apiKey || !baseUrl)
            throw new OfferUsageError(!process.env.MILLWORK_PROVIDER_API_KEY && baseUrl && storedCredentialBase(providerKeyFile(), detectOsCredentialStore()) !== undefined
                ? "The stored provider key belongs to a different API address."
                : "Online offer commands require MILLWORK_PROVIDER_API_KEY and MILLWORK_PROVIDER_API_URL from your secret store.");
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
