import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
const AUTHORIZATION_SCHEMA = "millwork.run-authorizations/v1";
const LEDGER_SCHEMA = "millwork.run-admission-ledger/v1";
const JOURNAL_SCHEMA = "millwork.run-admission-recovery-journal/v1";
const LOCK_RETRY_MS = 10;
const LOCK_ATTEMPTS = 500;
const ORPHAN_LOCK_STALE_MS = 5 * 60_000;
const LOCK_OWNER_FILE = "owner.json";
const ONE_RUN_APPROVAL_BRAND = Symbol("millwork.host-issued-one-run-approval");
const ONE_RUN_APPROVAL_SCHEMA = "millwork.one-run-approval/v1";
export class RunAdmissionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "RunAdmissionError";
    }
}
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, stableValue(item)]));
    }
    return value;
}
function stableJson(value) {
    return JSON.stringify(stableValue(value));
}
function money(value) {
    return Number(value.toFixed(6));
}
function verifierIdentity(request) {
    return request.mode === "echo" ? "platform.echo" : request.verifier_id ?? "platform.output_presence";
}
export function previewRunRequest(context) {
    const declaredMaximum = context.platform_fee_usd === null
        ? null
        : money(context.request.policy.budget.max_cost_usd + context.platform_fee_usd);
    const canonical = {
        account_id: context.account_id,
        task: context.request.task,
        verifier_id: verifierIdentity(context.request),
        arm_id: context.arm_id,
        provider_id: context.provider_id,
        access_lane: context.access_lane,
        mode: context.request.mode ?? "live",
        compose: context.request.compose ?? "auto",
        policy: context.request.policy,
        model_budget_usd: context.request.policy.budget.max_cost_usd,
        platform_fee_usd: context.platform_fee_usd,
        declared_maximum_usd: declaredMaximum,
    };
    return {
        ...canonical,
        request_hash: `sha256:${createHash("sha256").update(stableJson(canonical)).digest("hex")}`,
    };
}
export function createRunReplayKey(preview) {
    return `run:${preview.request_hash.slice("sha256:".length, "sha256:".length + 16)}:${randomUUID()}`;
}
/**
 * The exact document the host writes to approve one run, and the exact place
 * it writes it. The caller may print this; it may not produce it, because the
 * directory belongs to the host principal.
 */
export function hostOneRunApprovalRequest(boundary, preview, replayKey) {
    return {
        approval_file: boundary.approvalChannel
            ? join(boundary.approvalChannel.directory, `${preview.request_hash.replace("sha256:", "")}.json`)
            : null,
        document: {
            schema_version: ONE_RUN_APPROVAL_SCHEMA,
            account_id: preview.account_id,
            request_hash: preview.request_hash,
            replay_key: replayKey,
            declared_maximum_usd: preview.declared_maximum_usd,
            expires_at: "<an ISO 8601 instant after which this approval stops counting>",
        },
    };
}
/**
 * Read the host's approval for exactly this request, if the host has written
 * one. Returns null when the host offers no channel or has not answered yet —
 * waiting is the caller's business, and neither waiting nor being asked in a
 * terminal is an answer.
 */
export async function readHostOneRunApproval(boundary, preview, replayKey, now = () => new Date()) {
    const requested = hostOneRunApprovalRequest(boundary, preview, replayKey);
    if (requested.approval_file === null)
        return null;
    let details;
    try {
        details = await lstat(requested.approval_file);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw new RunAdmissionError("admission_storage_unavailable", "The host approval could not be inspected.");
    }
    if (!details.isFile() || details.isSymbolicLink() || details.uid !== boundary.hostPrincipalUid
        || (details.mode & 0o022) !== 0) {
        throw new RunAdmissionError("approval_not_host_issued", "A one-run approval must be a regular file written by the attesting host principal and writable by no one else.");
    }
    let document;
    try {
        document = JSON.parse(await readFile(requested.approval_file, "utf8"));
    }
    catch {
        throw new RunAdmissionError("approval_not_host_issued", "The host approval is unreadable or is not JSON.");
    }
    const expiresAt = typeof document.expires_at === "string" ? Date.parse(document.expires_at) : Number.NaN;
    if (document.schema_version !== ONE_RUN_APPROVAL_SCHEMA
        || document.account_id !== preview.account_id
        || document.request_hash !== preview.request_hash
        || document.replay_key !== replayKey
        || document.declared_maximum_usd !== preview.declared_maximum_usd) {
        throw new RunAdmissionError("approval_request_mismatch", "The host approved a different request, replay identity or declared maximum than this one.");
    }
    if (!Number.isFinite(expiresAt)) {
        throw new RunAdmissionError("approval_not_host_issued", "A one-run approval must carry an expiry instant.");
    }
    if (expiresAt <= now().getTime()) {
        throw new RunAdmissionError("approval_expired", "The host approval for this request has expired.");
    }
    return {
        kind: "one_run",
        approved_request_hash: preview.request_hash,
        approved_replay_key: replayKey,
        approved_not_after: document.expires_at,
        [ONE_RUN_APPROVAL_BRAND]: true,
    };
}
function numeric(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function stringArray(value) {
    return Array.isArray(value) && value.every(item => typeof item === "string" && item.trim() !== "");
}
function parseAuthorizationDocument(value) {
    if (value === null || typeof value !== "object") {
        throw new RunAdmissionError("authorization_file_invalid", "Run authorization file must contain an object.");
    }
    const document = value;
    if (document.schema_version !== AUTHORIZATION_SCHEMA || !Array.isArray(document.authorizations)) {
        throw new RunAdmissionError("authorization_file_invalid", `Run authorization file must use schema_version ${AUTHORIZATION_SCHEMA}.`);
    }
    const identities = new Set();
    for (const authorization of document.authorizations) {
        const coverage = authorization?.coverage;
        if (!authorization
            || typeof authorization.authorization_id !== "string"
            || authorization.authorization_id.trim() === ""
            || !coverage
            || typeof coverage.account_id !== "string"
            || !stringArray(coverage.verifier_ids)
            || !stringArray(coverage.arm_ids)
            || !stringArray(coverage.provider_ids)
            || !Array.isArray(coverage.access_lanes)
            || !coverage.access_lanes.every(lane => lane === "byok" || lane === "millwork_pool")
            || !coverage.policy
            || !Array.isArray(coverage.policy.data_classes)
            || !coverage.policy.data_classes.every(dataClass => ["public", "sandbox", "tenant_internal"].includes(dataClass))
            || (coverage.policy.on_eval !== undefined && (!Array.isArray(coverage.policy.on_eval)
                || !coverage.policy.on_eval.every(action => ["gate", "fallback", "repair_retry"].includes(action))))
            || !numeric(coverage.policy.max_runtime_s)
            || !numeric(authorization.per_run_cap_usd)
            || !numeric(authorization.lifetime_cap_usd)
            || Number.isNaN(Date.parse(authorization.expires_at))
            || (authorization.revoked_at !== undefined && authorization.revoked_at !== null
                && (typeof authorization.revoked_at !== "string" || Number.isNaN(Date.parse(authorization.revoked_at))))) {
            throw new RunAdmissionError("authorization_file_invalid", "Run authorization file contains an invalid authorization.");
        }
        if (identities.has(authorization.authorization_id)) {
            throw new RunAdmissionError("authorization_file_invalid", "Run authorization identities must be unique.");
        }
        identities.add(authorization.authorization_id);
    }
    return document;
}
async function secureRegularFile(path, purpose) {
    let details;
    try {
        details = await lstat(path);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return;
        throw new RunAdmissionError("admission_storage_unavailable", `${purpose} could not be inspected.`);
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!details.isFile() || details.isSymbolicLink() || (uid !== undefined && details.uid !== uid) || (details.mode & 0o077) !== 0) {
        throw new RunAdmissionError("admission_storage_insecure", `${purpose} must be an owner-only regular file and must not be a symbolic link.`);
    }
}
/**
 * The ledger lives in a directory the host created and owns, and this process
 * only reads there. Group write is refused along with world write: the whole
 * point of the directory is that the principal which spends the allowance
 * cannot edit the record of having spent it, and group write hands it exactly
 * that.
 */
async function requireHostLedgerDirectory(path) {
    let details;
    try {
        details = await lstat(path);
    }
    catch {
        throw new RunAdmissionError("admission_storage_unavailable", "The attested run admission directory does not exist. The host creates it; the CLI never invents it.");
    }
    if (!details.isDirectory() || details.isSymbolicLink() || (details.mode & 0o022) !== 0) {
        throw new RunAdmissionError("admission_storage_insecure", "Run admission directory must be a directory, must not be a symbolic link, and must not be writable by anyone but the host principal.");
    }
}
/**
 * The recovery journal's directory is the mirror image: this principal's own,
 * and nobody else's. That keeps a third principal out of it. It says nothing
 * about this principal, which owns the file and can rewrite it at will -- so
 * admission never lets its contents decide whether a run may happen.
 */
async function requireRecoveryJournalDirectory(path) {
    let details;
    try {
        details = await lstat(path);
    }
    catch {
        throw new RunAdmissionError("admission_storage_unavailable", "The attested run admission recovery journal directory does not exist. The host provisions it for the calling principal.");
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!details.isDirectory() || details.isSymbolicLink()
        || (uid !== undefined && details.uid !== uid) || (details.mode & 0o077) !== 0) {
        throw new RunAdmissionError("admission_storage_insecure", "Run admission recovery journal directory must be an owner-only directory belonging to the calling principal, and must not be a symbolic link.");
    }
}
/**
 * The standing authorization is the host's answer, so it must carry the host's
 * ownership. A file this process could have written is not an answer from
 * anyone else, whatever it says inside.
 */
async function requireHostOwnedAuthorizationFile(path, hostPrincipalUid) {
    let details;
    try {
        details = await lstat(path);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return;
        throw new RunAdmissionError("admission_storage_unavailable", "Run authorization file could not be inspected.");
    }
    if (!details.isFile() || details.isSymbolicLink() || details.uid !== hostPrincipalUid
        || (details.mode & 0o022) !== 0) {
        throw new RunAdmissionError("admission_storage_insecure", "Run authorization file must be a regular file owned by the attesting host principal and writable by no one else.");
    }
}
/**
 * Read the host's admission record. This process never writes it, so the file
 * must carry the host principal's ownership and nobody else's write bit; an
 * absent file is a host that has recorded nothing, which is safe here only
 * because this process cannot create one in a directory it cannot write.
 */
async function loadHostLedger(path, hostPrincipalUid) {
    let details;
    try {
        details = await lstat(path);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return { schema_version: LEDGER_SCHEMA, reservations: {} };
        }
        throw new RunAdmissionError("admission_storage_unavailable", "Run admission ledger could not be inspected.");
    }
    if (!details.isFile() || details.isSymbolicLink() || details.uid !== hostPrincipalUid
        || (details.mode & 0o022) !== 0) {
        throw new RunAdmissionError("admission_storage_insecure", "Run admission ledger must be a regular file owned by the attesting host principal and writable by no one else.");
    }
    try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        if (parsed.schema_version !== LEDGER_SCHEMA || parsed.reservations === null || typeof parsed.reservations !== "object") {
            throw new Error("invalid ledger shape");
        }
        return parsed;
    }
    catch (error) {
        if (error instanceof RunAdmissionError)
            throw error;
        throw new RunAdmissionError("admission_storage_unavailable", "Run admission ledger is unreadable or invalid.");
    }
}
async function loadRecoveryJournal(path) {
    await secureRegularFile(path, "Run admission recovery journal");
    try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        if (parsed.schema_version !== JOURNAL_SCHEMA || parsed.reservations === null || typeof parsed.reservations !== "object") {
            throw new Error("invalid journal shape");
        }
        return parsed;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return { schema_version: JOURNAL_SCHEMA, reservations: {} };
        }
        if (error instanceof RunAdmissionError)
            throw error;
        throw new RunAdmissionError("admission_storage_unavailable", "Run admission recovery journal is unreadable or invalid.");
    }
}
async function writeRecoveryJournal(path, ledger) {
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(temporary, "wx", 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`, "utf8");
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    await chmod(path, 0o600);
}
async function lockIsStale(lock, now) {
    let details;
    try {
        details = await lstat(lock);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return false;
        throw error;
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!details.isDirectory() || details.isSymbolicLink() || (uid !== undefined && details.uid !== uid)
        || (details.mode & 0o077) !== 0) {
        throw new RunAdmissionError("admission_storage_insecure", "Run admission recovery journal lock is not an owner-only directory.");
    }
    try {
        const owner = JSON.parse(await readFile(join(lock, LOCK_OWNER_FILE), "utf8"));
        const createdAt = typeof owner.created_at === "string" ? Date.parse(owner.created_at) : Number.NaN;
        if (!Number.isSafeInteger(owner.pid) || (owner.pid ?? 0) <= 0 || !Number.isFinite(createdAt)) {
            return now.getTime() - details.mtimeMs > ORPHAN_LOCK_STALE_MS;
        }
        try {
            process.kill(owner.pid, 0);
            return false;
        }
        catch (error) {
            return error.code === "ESRCH";
        }
    }
    catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) {
            return now.getTime() - details.mtimeMs > ORPHAN_LOCK_STALE_MS;
        }
        throw error;
    }
}
async function recoverStaleLock(lock, now) {
    const recoveryLock = `${lock}.recovery`;
    try {
        await mkdir(recoveryLock, { mode: 0o700 });
    }
    catch (error) {
        if (error.code === "EEXIST") {
            const details = await lstat(recoveryLock);
            if (now.getTime() - details.mtimeMs > ORPHAN_LOCK_STALE_MS) {
                await rm(recoveryLock, { recursive: true, force: true });
            }
            return;
        }
        throw new RunAdmissionError("admission_storage_unavailable", "Run admission recovery journal lock recovery could not start.");
    }
    try {
        if (await lockIsStale(lock, now))
            await rm(lock, { recursive: true, force: true });
    }
    finally {
        await rm(recoveryLock, { recursive: true, force: true });
    }
}
async function withRecoveryJournal(path, now, update) {
    await requireRecoveryJournalDirectory(dirname(path));
    const lock = `${path}.lock`;
    let acquired = false;
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
        try {
            await mkdir(lock, { mode: 0o700 });
            await writeFile(join(lock, LOCK_OWNER_FILE), `${JSON.stringify({
                pid: process.pid,
                created_at: now().toISOString(),
            })}\n`, { mode: 0o600 });
            acquired = true;
            break;
        }
        catch (error) {
            if (error.code !== "EEXIST") {
                throw new RunAdmissionError("admission_storage_unavailable", "Run admission recovery journal lock could not be created.");
            }
            await recoverStaleLock(lock, now());
            await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
        }
    }
    if (!acquired) {
        throw new RunAdmissionError("admission_storage_unavailable", "Run admission recovery journal is busy; no run was admitted.");
    }
    try {
        const journal = await loadRecoveryJournal(path);
        const result = await update(journal);
        await writeRecoveryJournal(path, journal);
        return result;
    }
    finally {
        await rm(lock, { recursive: true, force: true });
    }
}
export class RunAdmissionStore {
    boundary;
    ledgerFile;
    journalFile;
    now;
    constructor(options) {
        this.boundary = options.boundary;
        this.ledgerFile = options.boundary.ledgerFile;
        this.journalFile = options.boundary.recoveryJournalFile;
        this.now = options.now ?? (() => new Date());
    }
    /**
     * Admission answers two separate questions in a fixed order, and the order
     * is the security property.
     *
     * First: may this exact request happen at all? That is decided only by the
     * host -- by an approval it wrote where this principal cannot write. Nothing
     * this process can touch contributes to that answer.
     *
     * Only then: has it already been sent? That is a local bookkeeping question,
     * answered from this process's own journal, and it can only turn an
     * already-authorized `submit` into a `replay` or an `inspect`. A journal row
     * on its own is never a grant, so planting one buys nothing: the forger is
     * left exactly where they started, needing the host's approval.
     */
    async admit(input) {
        if (!input.replayKey.trim()) {
            throw new RunAdmissionError("missing_authorization", "A non-empty replay key is required before admission.");
        }
        const authority = await this.establishAuthority(input.preview, input.replayKey, input.oneRunApproval);
        // The host's own record can narrow what happens next -- it can close a
        // replay or contradict the request behind one -- but it is read-only here
        // and is never the thing that permits a run.
        const hostLedger = await this.readHostLedger();
        const hostRecord = hostLedger.reservations[input.replayKey];
        if (hostRecord) {
            if (hostRecord.request_hash !== input.preview.request_hash) {
                throw new RunAdmissionError("replay_request_mismatch", "The host has recorded a different reviewed request under this replay key. Use the original request or a new key.");
            }
            if (hostRecord.state === "released") {
                throw new RunAdmissionError("replay_closed", "The host recorded this replay as refused; it cannot start new work.");
            }
        }
        return withRecoveryJournal(this.journalFile, this.now, async (journal) => {
            const existing = journal.reservations[input.replayKey];
            if (existing) {
                if (existing.request_hash !== input.preview.request_hash) {
                    throw new RunAdmissionError("replay_request_mismatch", "This replay key belongs to a different reviewed request. Use the original request or a new key.");
                }
                if (existing.state === "released") {
                    throw new RunAdmissionError("replay_closed", "This replay was authoritatively refused and cannot start new work.");
                }
                // The journal belongs to the calling principal, so nothing it holds
                // may be reported as the authority for a run. What is reported is the
                // authority just re-established from the host, and the maximum from
                // the approved preview -- a reservation whose stored maximum
                // contradicts the approval is refused rather than echoed.
                if (existing.declared_maximum_usd !== input.preview.declared_maximum_usd) {
                    throw new RunAdmissionError("replay_request_mismatch", "This replay key belongs to a request with a different declared maximum. Use the original request with this replay key, or start a new request with a new replay key.");
                }
                return {
                    action: existing.execution_id ? "inspect" : "replay",
                    replay_key: input.replayKey,
                    request_hash: existing.request_hash,
                    authorization_kind: authority.kind,
                    authorization_id: authority.authorization_id,
                    declared_maximum_usd: input.preview.declared_maximum_usd,
                    execution_id: existing.execution_id,
                };
            }
            // Past this point a reservation is created, so this is the moment the
            // approved window has to still be open. Recovery above returns before
            // here: an unknown outcome stays recoverable after expiry, because
            // reconciling it starts no new work and buys nothing.
            if (this.now().getTime() >= authority.notAfter) {
                throw new RunAdmissionError("approval_expired", "The host approval for this request expired before the run was submitted. Ask the host for a new approval.");
            }
            if (input.preview.declared_maximum_usd === null) {
                throw new RunAdmissionError("charge_estimate_unavailable", "A paid run requires a known declared maximum before customer authorization.");
            }
            const timestamp = this.now().toISOString();
            journal.reservations[input.replayKey] = {
                request_hash: input.preview.request_hash,
                authorization_kind: authority.kind,
                authorization_id: authority.authorization_id,
                declared_maximum_usd: input.preview.declared_maximum_usd,
                state: "reserved",
                execution_id: null,
                charged_usd: null,
                created_at: timestamp,
                updated_at: timestamp,
            };
            return {
                action: "submit",
                replay_key: input.replayKey,
                request_hash: input.preview.request_hash,
                authorization_kind: authority.kind,
                authorization_id: authority.authorization_id,
                declared_maximum_usd: input.preview.declared_maximum_usd,
                execution_id: null,
            };
        });
    }
    async markAccepted(grant, executionId) {
        await this.updateReservation(grant, (reservation) => {
            if (reservation.state === "released" || reservation.state === "settled"
                || (reservation.execution_id !== null && reservation.execution_id !== executionId)) {
                throw new RunAdmissionError("admission_storage_unavailable", "Run admission reservation cannot accept this execution.");
            }
            reservation.state = "accepted";
            reservation.execution_id = executionId;
        });
    }
    async settle(grant, chargedUsd) {
        if (!numeric(chargedUsd)) {
            throw new RunAdmissionError("admission_storage_unavailable", "Receipt charge must be a non-negative number.");
        }
        await this.updateReservation(grant, (reservation) => {
            if (reservation.state !== "accepted" && reservation.state !== "settled") {
                throw new RunAdmissionError("admission_storage_unavailable", "Only an accepted execution can settle a reservation.");
            }
            reservation.state = "settled";
            reservation.charged_usd = money(chargedUsd);
        });
    }
    /**
     * Settle an accepted reservation from an authoritative receipt when the
     * caller recovered through another surface (for example MCP after CLI, or
     * CLI after MCP) and therefore no longer holds the original in-memory grant.
     */
    async settleAcceptedExecution(executionId, chargedUsd) {
        if (!executionId.trim() || !numeric(chargedUsd)) {
            throw new RunAdmissionError("admission_storage_unavailable", "Receipt settlement requires an execution id and non-negative charge.");
        }
        return withRecoveryJournal(this.journalFile, this.now, async (journal) => {
            const matches = Object.values(journal.reservations).filter((reservation) => reservation.execution_id === executionId);
            if (matches.length === 0)
                return false;
            if (matches.length !== 1) {
                throw new RunAdmissionError("admission_storage_unavailable", "More than one run admission reservation names this execution.");
            }
            const reservation = matches[0];
            if (reservation.state !== "accepted" && reservation.state !== "settled") {
                throw new RunAdmissionError("admission_storage_unavailable", "Only an accepted execution can settle from a receipt.");
            }
            reservation.state = "settled";
            reservation.charged_usd = money(chargedUsd);
            return true;
        });
    }
    async releaseAfterAuthoritativeRefusal(grant, reason) {
        await this.updateReservation(grant, (reservation) => {
            if (reservation.state !== "reserved" || reservation.execution_id !== null) {
                throw new RunAdmissionError("admission_storage_unavailable", "An accepted execution reservation cannot be released.");
            }
            reservation.state = "released";
            reservation.release_reason = reason;
        });
    }
    async readHostLedger() {
        await requireHostLedgerDirectory(dirname(this.ledgerFile));
        return loadHostLedger(this.ledgerFile, this.boundary.hostPrincipalUid);
    }
    /**
     * Who says this run may happen. Exactly one answer is possible here: the
     * host's approval for this exact request and this exact replay identity.
     */
    async establishAuthority(preview, replayKey, oneRunApproval) {
        if (oneRunApproval === undefined)
            return this.refuseStandingAuthorization(preview);
        if (oneRunApproval[ONE_RUN_APPROVAL_BRAND] !== true
            || oneRunApproval.approved_request_hash !== preview.request_hash
            || oneRunApproval.approved_replay_key !== replayKey) {
            throw new RunAdmissionError("approval_request_mismatch", "The one-run approval does not match this exact reviewed request and replay identity.");
        }
        const notAfter = Date.parse(oneRunApproval.approved_not_after);
        if (!Number.isFinite(notAfter)) {
            throw new RunAdmissionError("approval_not_host_issued", "A one-run approval must carry an expiry instant.");
        }
        return { kind: "one_run", authorization_id: null, notAfter };
    }
    /**
     * A standing authorization is a promise about many future runs, and a
     * promise with a lifetime cap is only worth the record of what has been
     * spent against it. In this profile that record is the host's ledger, which
     * this process cannot write -- so it cannot consume allowance, and a cap
     * that never advances is not a cap. Rather than pretend otherwise, standing
     * authorization admits nothing here and says why.
     *
     * The host's file is still inspected first, so a standing authorization the
     * caller could have edited, or one that is malformed, is still named as the
     * broken thing it is instead of being quietly stepped over.
     */
    async refuseStandingAuthorization(preview) {
        const authorizationFile = this.boundary.authorizationFile;
        if (authorizationFile === null) {
            throw new RunAdmissionError("missing_authorization", "This host publishes no standing run authorization, so nothing here can authorize an unattended paid run.");
        }
        await requireHostOwnedAuthorizationFile(authorizationFile, this.boundary.hostPrincipalUid);
        try {
            parseAuthorizationDocument(JSON.parse(await readFile(authorizationFile, "utf8")));
        }
        catch (error) {
            if (error.code === "ENOENT") {
                throw new RunAdmissionError("missing_authorization", "No customer run authorization covers this request.");
            }
            if (error instanceof RunAdmissionError)
                throw error;
            throw new RunAdmissionError("authorization_file_invalid", "Run authorization file is unreadable or invalid.");
        }
        throw new RunAdmissionError("missing_authorization", `A standing run authorization cannot admit a run here: its lifetime allowance could only be enforced against a record of what has been spent, and the attested ledger is owned by the host principal and read-only to this process, so this process cannot record a reservation against it. Run ${preview.request_hash} needs the host's one-run approval instead.`);
    }
    async updateReservation(grant, update) {
        await withRecoveryJournal(this.journalFile, this.now, (journal) => {
            const reservation = journal.reservations[grant.replay_key];
            if (!reservation || reservation.request_hash !== grant.request_hash) {
                throw new RunAdmissionError("admission_storage_unavailable", "Run admission reservation is missing or changed.");
            }
            update(reservation);
            reservation.updated_at = this.now().toISOString();
        });
    }
}
