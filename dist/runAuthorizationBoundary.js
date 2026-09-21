// Decision D1-C: standing run authorization is unsupported wherever the agent
// principal can write the authority it would be checked against, and a one-run
// approval counts only when it arrives through a channel that principal cannot
// drive. Neither fact can be asserted by the process itself, so the only trust
// root this module accepts is a host attestation owned by a different operating
// system principal: a principal the agent is not can create it, and the agent
// cannot. Launch-time environment selects nothing here, because an environment
// the agent can set is an environment the agent can point at its own files.
//
// The same test applies to the record authority is checked against. The agent
// principal must not be able to write the admission ledger, by ownership or by
// group, because a record it can delete or overwrite is a record that says
// whatever it needs to say. Where that isolation cannot be established this
// module refuses the profile outright, before anything is sent.
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
export const RUN_AUTHORIZATION_BOUNDARY_SCHEMA = "millwork.run-authorization-boundary/v1";
export const HOST_RUN_AUTHORIZATION_ATTESTATION_FILE = "/etc/millwork/run-authorization-boundary.json";
export const HOST_ISOLATED_PRINCIPAL_PROFILE = "host_isolated_principal";
/**
 * Environment names that used to select the authorization file, the admission
 * ledger, or the agent-writable roots. They are withdrawn rather than ignored:
 * a launch environment that still carries one is reporting an attempt to choose
 * run authority, and the honest answer to that attempt is a refusal.
 */
export const WITHDRAWN_RUN_AUTHORITY_ENVIRONMENT_NAMES = [
    "MILLWORK_RUN_AUTHORIZATION_FILE",
    "MILLWORK_RUN_ADMISSION_LEDGER_FILE",
    "MILLWORK_AGENT_WRITABLE_ROOTS",
];
function processUid() {
    return typeof process.getuid === "function" ? process.getuid() : undefined;
}
/**
 * True host ownership: the path, and every directory above it, belongs to a
 * principal this process is not, and no one but that principal may write it.
 *
 * There is deliberately no exemption here. An earlier revision let the ledger
 * directory be group-writable, on the reasoning that group write is how a host
 * hands the CLI principal its own reservation store. It is also how the CLI
 * principal deletes or rewrites that store: with group write, the process that
 * spends the allowance is the process that keeps the record of having spent it,
 * so one `unlink` — or one plain overwrite — resets the history the next
 * admission is checked against. Group write on the ledger directory is
 * therefore no different from no boundary at all.
 */
async function hostOwnedChainFailure(path, uid) {
    const writeBits = 0o022;
    let current = resolve(path);
    for (;;) {
        let details;
        try {
            details = await lstat(current);
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return { path: current, detail: `${current} does not exist.` };
            }
            return { path: current, detail: `${current} could not be inspected.` };
        }
        if (details.isSymbolicLink()) {
            return { path: current, detail: `${current} is a symbolic link, so its target can be changed.` };
        }
        if (details.uid === uid) {
            return {
                path: current,
                detail: `${current} is owned by this process's own principal, which can therefore rewrite it.`,
            };
        }
        if ((details.mode & writeBits) !== 0) {
            return {
                path: current,
                detail: `${current} is writable by a principal other than its owner.`,
            };
        }
        const parent = dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
/**
 * The attested ledger itself, when it exists. The directory above it has
 * already been proved host-owned, so this cannot be a file the CLI principal
 * created; what it rules out is a host that placed a file there and then left
 * it owned by, or writable by, somebody else.
 */
async function hostOwnedLedgerFileFailure(path, hostPrincipalUid) {
    let details;
    try {
        details = await lstat(path);
    }
    catch (error) {
        // An absent ledger is a host that has recorded nothing yet. It is not a
        // gap, because this process cannot create one in a directory it cannot
        // write, and an empty record grants nothing on its own.
        if (error.code === "ENOENT")
            return null;
        return { path, detail: `${path} could not be inspected.` };
    }
    if (details.isSymbolicLink()) {
        return { path, detail: `${path} is a symbolic link, so its target can be changed.` };
    }
    if (!details.isFile()) {
        return { path, detail: `${path} is not a regular file.` };
    }
    if (details.uid !== hostPrincipalUid) {
        return { path, detail: `${path} is not owned by the principal that wrote the attestation.` };
    }
    if ((details.mode & 0o022) !== 0) {
        return { path, detail: `${path} is writable by a principal other than its owner.` };
    }
    return null;
}
/**
 * The recovery journal is this process's own file, so the check is the mirror
 * image: it must belong to this principal and to nobody else. That proves no
 * third principal can plant reservations in it. It deliberately proves nothing
 * about this principal, which can of course rewrite its own file — which is
 * exactly why admission never treats a journal row as authority.
 */
async function callerOwnedJournalDirectoryFailure(path, uid) {
    let details;
    try {
        details = await lstat(path);
    }
    catch (error) {
        return error.code === "ENOENT"
            ? { path, detail: `${path} does not exist. The host provisions it for the calling principal.` }
            : { path, detail: `${path} could not be inspected.` };
    }
    if (details.isSymbolicLink()) {
        return { path, detail: `${path} is a symbolic link, so its target can be changed.` };
    }
    if (!details.isDirectory()) {
        return { path, detail: `${path} is not a directory.` };
    }
    if (details.uid !== uid) {
        return { path, detail: `${path} does not belong to the calling principal, so its recovery record is somebody else's to write.` };
    }
    if ((details.mode & 0o077) !== 0) {
        return { path, detail: `${path} is readable or writable by principals other than its owner.` };
    }
    return null;
}
function unsupported(attestationFile, reason, detail) {
    return { supported: false, reason, detail, attestationFile };
}
function absoluteString(value) {
    return typeof value === "string" && value.trim() !== "" && isAbsolute(value) ? value : null;
}
/**
 * The document half of the boundary, separated from the ownership half so the
 * shape rules can be exercised directly. Parsing decides what the host asked
 * for; only ownership decides whether the host was the one asking.
 */
export function parseHostAttestation(document, attestationFile) {
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
        return { ok: false, detail: `${attestationFile} must contain a JSON object.` };
    }
    const parsed = document;
    if (parsed.schema_version !== RUN_AUTHORIZATION_BOUNDARY_SCHEMA) {
        return { ok: false, detail: `${attestationFile} must use schema_version ${RUN_AUTHORIZATION_BOUNDARY_SCHEMA}.` };
    }
    if (parsed.profile !== HOST_ISOLATED_PRINCIPAL_PROFILE) {
        return {
            ok: false,
            detail: `${attestationFile} must declare profile ${HOST_ISOLATED_PRINCIPAL_PROFILE}; no other profile is supported.`,
        };
    }
    const ledgerFile = absoluteString(parsed.run_admission_ledger_file);
    if (!ledgerFile) {
        return { ok: false, detail: `${attestationFile} must name an absolute run_admission_ledger_file.` };
    }
    // The host must say where the caller keeps its own in-flight reservations,
    // because the caller can no longer keep them beside the ledger. Without that
    // place the caller cannot tell a recovery from a new run, and a run it cannot
    // tell apart from a recovery is a run it may buy twice.
    const recoveryJournalFile = absoluteString(parsed.run_admission_recovery_journal_file);
    if (!recoveryJournalFile) {
        return {
            ok: false,
            detail: `${attestationFile} must name an absolute run_admission_recovery_journal_file in a directory the calling principal owns.`,
        };
    }
    if (resolve(recoveryJournalFile) === resolve(ledgerFile)) {
        return {
            ok: false,
            detail: `${attestationFile} points run_admission_recovery_journal_file at the host ledger. The caller-writable recovery record and the host's read-only record cannot be the same file.`,
        };
    }
    let authorizationFile = null;
    if (parsed.run_authorization_file !== undefined && parsed.run_authorization_file !== null) {
        authorizationFile = absoluteString(parsed.run_authorization_file);
        if (!authorizationFile) {
            return {
                ok: false,
                detail: `${attestationFile} declares run_authorization_file, so it must be an absolute path.`,
            };
        }
    }
    let approvalChannel = null;
    if (parsed.one_run_approval !== undefined && parsed.one_run_approval !== null) {
        const channel = parsed.one_run_approval;
        const directory = absoluteString(channel.directory);
        if (channel.kind !== "host_approved_file" || !directory) {
            return {
                ok: false,
                detail: `${attestationFile} declares one_run_approval, so it must be {"kind":"host_approved_file","directory":"<absolute path>"}.`,
            };
        }
        approvalChannel = { kind: "host_approved_file", directory };
    }
    return { ok: true, attestation: { ledgerFile, recoveryJournalFile, authorizationFile, approvalChannel } };
}
/**
 * Resolve the run-authorization trust boundary for this process. A supported
 * result is a capability: the admission store trusts the paths it names because
 * this function proved another principal owns them. Every other result refuses,
 * and says which check failed rather than implying the run could work elsewhere.
 */
export async function resolveRunAuthorizationBoundary(options = {}) {
    const environment = options.environment ?? process.env;
    const attestationFile = options.attestationFile ?? HOST_RUN_AUTHORIZATION_ATTESTATION_FILE;
    const overrides = WITHDRAWN_RUN_AUTHORITY_ENVIRONMENT_NAMES.filter((name) => environment[name] !== undefined);
    if (overrides.length > 0) {
        return unsupported(attestationFile, "launch_environment_override", `${overrides.join(", ")} no longer selects run authority, and a launch environment carrying it is not trusted to ask for a paid run. Unset it and use the host attestation.`);
    }
    const uid = processUid();
    if (uid === undefined) {
        return unsupported(attestationFile, "host_principal_unavailable", "This platform exposes no process principal, so no separation between the agent and the approving host can be verified.");
    }
    const attestationFailure = await hostOwnedChainFailure(attestationFile, uid);
    if (attestationFailure) {
        const missing = attestationFailure.detail.endsWith("does not exist.");
        return unsupported(attestationFile, missing ? "attestation_missing" : "attestation_not_host_owned", missing
            ? `No host run-authorization attestation at ${attestationFile}. Standing authorization is unsupported here and there is no independent approval channel, so a paid run cannot be authorized from this environment.`
            : attestationFailure.detail);
    }
    let document;
    let hostPrincipalUid;
    try {
        hostPrincipalUid = (await lstat(attestationFile)).uid;
        document = JSON.parse(await readFile(attestationFile, "utf8"));
    }
    catch {
        return unsupported(attestationFile, "attestation_invalid", `${attestationFile} is unreadable or is not JSON.`);
    }
    const parsed = parseHostAttestation(document, attestationFile);
    if (!parsed.ok)
        return unsupported(attestationFile, "attestation_invalid", parsed.detail);
    const { ledgerFile, recoveryJournalFile, authorizationFile, approvalChannel } = parsed.attestation;
    const ledgerFailure = await hostOwnedChainFailure(dirname(ledgerFile), uid);
    if (ledgerFailure) {
        return unsupported(attestationFile, "ledger_directory_unusable", `The attested admission ledger directory is not isolated from this process: ${ledgerFailure.detail} A ledger this principal can write is a ledger it can reset, so no run is authorized from here.`);
    }
    const ledgerFileFailure = await hostOwnedLedgerFileFailure(ledgerFile, hostPrincipalUid);
    if (ledgerFileFailure) {
        return unsupported(attestationFile, "ledger_file_not_host_owned", `The attested admission ledger is not isolated from this process: ${ledgerFileFailure.detail}`);
    }
    const journalFailure = await callerOwnedJournalDirectoryFailure(dirname(recoveryJournalFile), uid);
    if (journalFailure) {
        return unsupported(attestationFile, "recovery_journal_not_caller_owned", `The attested recovery journal directory is not the calling principal's own: ${journalFailure.detail}`);
    }
    // With a read-only ledger this process cannot record what a standing
    // authorization has spent, so a standing authorization cannot be enforced
    // and cannot admit anything (see RunAdmissionStore). That leaves the host's
    // per-run approval as the only authority here, and a host that offers no
    // approval channel is a host that can authorize no paid run at all. Saying
    // so now is the honest answer, and it is said before anything is sent.
    if (!approvalChannel) {
        return unsupported(attestationFile, "approval_channel_unavailable", `${attestationFile} attests no one-run approval channel. A paid run here rests on an approval the host writes where this process cannot, and nothing else in this profile can stand in for it, so no paid run can be authorized from this environment.`);
    }
    if (authorizationFile) {
        const authorizationFailure = await hostOwnedChainFailure(authorizationFile, uid);
        if (authorizationFailure) {
            return unsupported(attestationFile, "authorization_file_not_host_owned", `The attested standing authorization is not host-owned: ${authorizationFailure.detail}`);
        }
    }
    const channelFailure = await hostOwnedChainFailure(approvalChannel.directory, uid);
    if (channelFailure) {
        return unsupported(attestationFile, "approval_channel_not_host_owned", `The attested one-run approval channel is not host-owned, so this process could write its own approval: ${channelFailure.detail}`);
    }
    return {
        supported: true,
        boundary: {
            attestationFile,
            profile: HOST_ISOLATED_PRINCIPAL_PROFILE,
            hostPrincipalUid,
            authorizationFile,
            ledgerFile,
            recoveryJournalFile,
            approvalChannel,
        },
    };
}
/** The refusal a caller must report when no paid run can be authorized here. */
export function unsupportedRunBoundaryReport(resolution) {
    return {
        refusal_code: "unsupported_run_authorization_boundary",
        reason: resolution.reason,
        detail: resolution.detail,
        attestation_file: resolution.attestationFile,
        supported_profile: HOST_ISOLATED_PRINCIPAL_PROFILE,
    };
}
