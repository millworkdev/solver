import { randomUUID } from "node:crypto";
function truthyCi(value) {
    return Boolean(value && !["0", "false"].includes(value.toLowerCase()));
}
export function verifierEntryBrowserRequested(input) {
    if (input.args.includes("--open-browser") && input.args.includes("--no-browser")) {
        throw new Error("--open-browser and --no-browser cannot be used together");
    }
    if (input.args.includes("--no-browser"))
        return false;
    if (input.args.includes("--open-browser"))
        return true;
    const environment = input.environment ?? process.env;
    const platform = input.platform ?? process.platform;
    const remote = Boolean(environment.SSH_CONNECTION || environment.SSH_CLIENT || environment.SSH_TTY);
    const noDesktop = platform === "linux" && !environment.DISPLAY && !environment.WAYLAND_DISPLAY;
    return input.interactive && !remote && !truthyCi(environment.CI) && !noDesktop;
}
/** One browser/terminal decision for connect, replace, and restore. */
export async function acquireVerifierKeyEntry(input) {
    if (input.existingSecret)
        return { kind: "secret", secret: input.existingSecret };
    const wantsBrowser = verifierEntryBrowserRequested(input);
    if (wantsBrowser && input.openBrowser) {
        let launch;
        try {
            launch = await input.openBrowser(input.continueUrl);
        }
        catch {
            launch = "failed";
        }
        if (launch === "requested" || launch === "timed_out") {
            if (!input.interactive)
                return { kind: "resume" };
            input.err("Browser opened. Waiting for the key to be saved; keep this command running.\n");
            const expiresAt = Date.parse(input.expiresAt);
            const now = input.now ?? Date.now;
            const sleepFor = input.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
            const maxPolls = input.maxPolls ?? 300;
            for (let poll = 0; poll <= maxPolls && Number.isFinite(expiresAt) && now() < expiresAt; poll += 1) {
                const recovery = await input.recover();
                if (recovery.kind === "recovered")
                    return { kind: "staged", staged: recovery.staged };
                if (recovery.kind === "unknown")
                    return { kind: "resume" };
                if (poll < maxPolls)
                    await sleepFor(1_000);
            }
            return { kind: "resume" };
        }
        if (input.interactive) {
            input.err("Couldn’t open your browser. Enter the key here, or press Enter to continue with the private-page link below.\n");
        }
    }
    if (input.interactive)
        input.out(`Private key-entry page: ${input.continueUrl}\n`);
    const secret = await input.readSecret();
    return secret ? { kind: "secret", secret } : { kind: "resume" };
}
export class VerifierIntakeError extends Error {
    failure;
    status;
    retryAfterSeconds;
    constructor(failure, status, retryAfterSeconds = null) {
        super(failure);
        this.failure = failure;
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
        this.name = "VerifierIntakeError";
    }
    get mayHaveCommitted() {
        return this.failure === "intake_refused"
            || this.failure === "outcome_unknown"
            || this.failure === "unavailable";
    }
}
function parseRetryAfter(value, now = Date.now()) {
    if (!value)
        return null;
    if (/^\d+$/.test(value.trim()))
        return Math.max(0, Number(value.trim()));
    const at = Date.parse(value);
    return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}
/** Accept the verifier intake only when its origin matches an independently trusted origin. */
export function trustedVerifierIntakeUrl(continueUrl, trustedOrigin) {
    let url;
    let origin;
    try {
        url = new URL(continueUrl);
        origin = new URL(trustedOrigin);
    }
    catch {
        throw new VerifierIntakeError("authentication_refused", null);
    }
    const intent = url.searchParams.get("intent");
    if (url.protocol !== "https:"
        || url.username
        || url.password
        || url.hash
        || url.pathname !== "/connect/verifier"
        || url.origin !== origin.origin
        || [...url.searchParams.keys()].some((key) => key !== "intent")
        || !intent) {
        throw new VerifierIntakeError("authentication_refused", null);
    }
    return url;
}
/** Posts a key once and converts every refusal into a typed, secret-free outcome. */
export async function submitVerifierIntake(input) {
    let response;
    try {
        response = await (input.fetchImpl ?? fetch)(input.url, {
            method: "POST",
            redirect: "error",
            headers: {
                authorization: `Bearer ${input.apiKey}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ secret: input.secret }),
        });
    }
    catch {
        throw new VerifierIntakeError("outcome_unknown", null);
    }
    if (!response.ok) {
        if (response.status === 401) {
            throw new VerifierIntakeError("authentication_refused", response.status);
        }
        if (response.status === 403) {
            const refusal = await response.json().catch(() => undefined);
            throw new VerifierIntakeError(refusal?.reason === "tenant_admission_required" ? "admission_refused" : "authentication_refused", response.status);
        }
        if (response.status === 409) {
            throw new VerifierIntakeError("intake_refused", response.status);
        }
        if (response.status === 429) {
            throw new VerifierIntakeError("rate_limited", response.status, parseRetryAfter(response.headers.get("retry-after")));
        }
        if (response.status === 503) {
            throw new VerifierIntakeError("unavailable", response.status);
        }
        if (response.status >= 400 && response.status < 500) {
            throw new VerifierIntakeError("request_refused", response.status);
        }
        throw new VerifierIntakeError("unavailable", response.status);
    }
    let value;
    try {
        value = await response.json();
    }
    catch {
        throw new VerifierIntakeError("outcome_unknown", response.status);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new VerifierIntakeError("outcome_unknown", response.status);
    }
    const candidate = value;
    if (typeof candidate.handle !== "string"
        || !/^cred_v_[a-f0-9]{32}$/.test(candidate.handle)
        || !Number.isSafeInteger(candidate.captured_generation)
        || Number(candidate.captured_generation) < 0) {
        throw new VerifierIntakeError("outcome_unknown", response.status);
    }
    return {
        handle: candidate.handle,
        captured_generation: Number(candidate.captured_generation),
    };
}
export const VERIFIER_LIFECYCLE_COMMANDS = new Set(["replace", "restore", "continue", "disconnect"]);
export class VerifierLifecycleUsageError extends Error {
}
const FAILURE_COPY = {
    authentication_failed: "Your endpoint did not accept the new key.",
    timeout: "Your endpoint did not answer in time.",
    network: "Millwork could not reach your endpoint.",
    egress_rejected: "Millwork could not reach your endpoint.",
    http_error: "Your endpoint answered with an error.",
    invalid_response: "Your endpoint's response needs a fix.",
};
const ENDPOINT_DENIAL = "The earlier key may still work at your endpoint. Remove it from your endpoint's configuration, then confirm the endpoint rejects it.";
function failureCopy(reason) {
    return (reason && FAILURE_COPY[reason]) ?? "The test did not pass.";
}
function flag(args, name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}
function parseStopChoice(args) {
    const raw = flag(args, "--stop-days");
    const date = flag(args, "--stop-date");
    const timeZone = flag(args, "--time-zone");
    if (raw !== undefined && (date !== undefined || timeZone !== undefined)) {
        throw new VerifierLifecycleUsageError("Use --stop-days or --stop-date with --time-zone, not both");
    }
    if (date !== undefined) {
        const parsed = new Date(`${date}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime())
            || parsed.toISOString().slice(0, 10) !== date) {
            throw new VerifierLifecycleUsageError("--stop-date must be a real calendar date in YYYY-MM-DD form");
        }
        try {
            if (!timeZone)
                throw new Error();
            new Intl.DateTimeFormat("en", { timeZone }).format();
        }
        catch {
            throw new VerifierLifecycleUsageError("--time-zone must be an IANA time zone when --stop-date is used");
        }
        return { kind: "calendar_date", date, time_zone: timeZone };
    }
    if (raw === undefined)
        throw new VerifierLifecycleUsageError("Choose --stop-days <30|90|180|365|0> or --stop-date <YYYY-MM-DD> --time-zone <IANA-zone>");
    const days = Number(raw);
    if (days === 0)
        return { kind: "no_expiration" };
    if (days === 30 || days === 90 || days === 180 || days === 365)
        return { kind: "preset_days", days };
    throw new VerifierLifecycleUsageError("--stop-days must be 30, 90, 180, 365, or 0 for no Millwork stop date");
}
function stopChoiceCommandFlags(args) {
    const date = flag(args, "--stop-date");
    return date
        ? `--stop-date ${date} --time-zone ${flag(args, "--time-zone")}`
        : `--stop-days ${flag(args, "--stop-days") ?? "<30|90|180|365|0>"}`;
}
function requireVerifierId(args, command) {
    const verifierId = flag(args, "--verifier-id");
    if (!verifierId || verifierId.startsWith("--"))
        throw new VerifierLifecycleUsageError(`verifier ${command} requires --verifier-id <id>`);
    return verifierId;
}
function report(io, document, human) {
    if (io.interactive)
        io.out(`${human.join("\n")}\n`);
    else
        io.emitJson(document);
}
export async function runVerifierLifecycle(solver, command, args, io) {
    const verifierId = requireVerifierId(args, command);
    const operation = `verifier_${command}`;
    if (command === "disconnect")
        return disconnect(solver, verifierId, args, io);
    if (command === "continue")
        return continuePending(solver, verifierId, args, io, operation);
    try {
        verifierEntryBrowserRequested({ args, interactive: io.interactive, environment: io.environment, platform: io.platform });
    }
    catch (error) {
        throw new VerifierLifecycleUsageError(error instanceof Error ? error.message : "Invalid browser option");
    }
    let before;
    try {
        before = await solver.verifierConnection.inspect(verifierId);
    }
    catch {
        before = undefined;
    }
    // Each command applies only to a state it has actually observed.
    const applies = command === "replace"
        ? before?.status === "active"
        : before?.status === "revoked" || before?.status === "expired";
    if (!applies)
        return reportNotApplicable(io, operation, verifierId, command, before);
    const stopChoice = parseStopChoice(args);
    const intent = await solver.verifierConnection.createIntent(verifierId, stopChoice, { idempotencyKey: flag(args, "--idempotency-key") });
    // DC-9: the entry intent is the logical operation for entry and
    // test-and-promote, so a continuation promotes exactly the key entered for it.
    const key = intent.intent_id;
    if (io.interactive) {
        if (command === "replace")
            io.err("Before continuing, configure your endpoint to accept both your current key and the new one.\n");
        else
            io.err("Enter a new key issued by your endpoint. Millwork will not use a disconnected or stopped key again.\n");
        if (intent.origin)
            io.err(`Destination origin: ${intent.origin}\n`);
    }
    // Refuse an untrusted intake before anyone types a key for it.
    let intakeUrl;
    try {
        intakeUrl = trustedVerifierIntakeUrl(intent.continue_url, io.trustedIntakeOrigin ?? intent.intake_origin ?? io.serverOrigin ?? "");
    }
    catch {
        throw new VerifierLifecycleUsageError("The key-entry URL is not the trusted customer-app verifier intake; no key was requested or sent.");
    }
    const acquired = await acquireVerifierKeyEntry({
        args,
        interactive: io.interactive,
        continueUrl: intakeUrl.href,
        expiresAt: intent.expires_at,
        existingSecret: io.existingSecret,
        readSecret: io.readSecret,
        openBrowser: io.openBrowser,
        environment: io.environment,
        platform: io.platform,
        sleep: io.sleep,
        maxPolls: io.maxPolls,
        now: io.now,
        out: io.out,
        err: io.err,
        recover: async () => {
            const view = await readBack(solver, verifierId, key);
            if (unreadable(view))
                return { kind: "unknown" };
            const pending = view?.pending_key;
            const staged = lastOperation(view);
            if (pending && staged?.kind === "stage" && staged.phase === "admitted" && staged.state.handle === pending.handle) {
                return { kind: "recovered", staged: { handle: pending.handle, captured_generation: pending.captured_generation } };
            }
            return { kind: "pending" };
        },
    });
    if (acquired.kind === "resume") {
        const next = intentContinueCommand(verifierId, key);
        report(io, {
            operation,
            state: "action_required",
            verifier_id: verifierId,
            operation_key: key,
            continue_url: intent.continue_url,
            intent_id: intent.intent_id,
            origin: intent.origin,
            expires_at: intent.expires_at,
            next,
        }, [
            `Open this page to enter the key privately: ${intent.continue_url}`,
            `Then finish with: ${next}`,
        ]);
        return 2;
    }
    if (acquired.kind === "staged") {
        return testAndReport(solver, verifierId, acquired.staged, before?.handle ?? null, io, operation, key);
    }
    const secret = acquired.secret;
    let staged;
    try {
        staged = await submitVerifierIntake({
            url: intakeUrl,
            secret,
            apiKey: io.apiKey,
            fetchImpl: io.fetchImpl,
        });
    }
    catch (error) {
        if (!(error instanceof VerifierIntakeError))
            throw error;
        return recoverIntakeFailure(solver, verifierId, command, args, io, operation, key, before?.handle ?? null, error);
    }
    return testAndReport(solver, verifierId, staged, before?.handle ?? null, io, operation, key);
}
/** The next command for a state the command does not apply to. Restore is
 *  offered only for a confirmed stopped key, connect only for a verifier that
 *  never had one; an unreadable state is reported as such. */
function reportNotApplicable(io, operation, verifierId, command, before) {
    const status = before?.status ?? "unknown";
    if (unreadable(before)) {
        report(io, { operation, state: "unknown", verifier_id: verifierId, connection_status: "unknown", next_action: "inspect" }, [
            `Current access could not be confirmed. Check the connection before ${command === "replace" ? "replacing its key" : "restoring it"}.`,
            `Check it on the dashboard's Verifiers page, or with the SDK's verifierConnection.inspect("${verifierId}").`,
        ]);
        return 2;
    }
    const next = status === "active"
        ? { action: "replace", command: `millwork verifier replace --verifier-id ${verifierId} --stop-days <30|90|180|365|0>`, line: "This verifier already has an active key. Replace it with:" }
        : status === "revoked" || status === "expired"
            ? { action: "restore", command: `millwork verifier restore --verifier-id ${verifierId} --stop-days <30|90|180|365|0>`, line: "There is no active key to replace. Millwork has stopped using this verifier's key; restore it with a new key:" }
            : { action: "connect", command: `millwork verifier connect --verifier-id ${verifierId}`, line: "This verifier has no connected key yet. Connect one with:" };
    report(io, { operation, state: "not_applicable", verifier_id: verifierId, connection_status: status, next_action: next.action, next: next.command }, [
        next.line,
        next.command,
    ]);
    return 2;
}
async function recoverIntakeFailure(solver, verifierId, command, args, io, operation, operationKey, previousHandle, error) {
    if (error.mayHaveCommitted) {
        const recovered = await readBack(solver, verifierId, operationKey);
        const pending = recovered?.pending_key;
        const staged = lastOperation(recovered);
        if (pending
            && staged?.kind === "stage"
            && staged.phase === "admitted"
            && staged.state.handle === pending.handle) {
            return testAndReport(solver, verifierId, { handle: pending.handle, captured_generation: pending.captured_generation }, previousHandle, io, operation, operationKey);
        }
    }
    if (error.failure === "rate_limited") {
        const retryAfter = error.retryAfterSeconds;
        const next = `millwork verifier ${command} --verifier-id ${verifierId} ${stopChoiceCommandFlags(args)}`;
        report(io, {
            operation,
            state: "retry_required",
            verifier_id: verifierId,
            operation_key: operationKey,
            retry_after_seconds: retryAfter,
            next_action: "retry_intake",
            next,
        }, [
            retryAfter === null
                ? "Too many key-entry requests. Try again later with:"
                : `Too many key-entry requests. Wait at least ${retryAfter} seconds, then try again with:`,
            next,
        ]);
        return 2;
    }
    if (error.failure === "authentication_refused") {
        report(io, {
            operation,
            state: "refused",
            verifier_id: verifierId,
            operation_key: operationKey,
            next_action: "start_new_intent",
        }, [
            "The key-entry request was refused. Use the API key that created this intent, or start a new operation.",
        ]);
        return 2;
    }
    if (error.failure === "admission_refused") {
        report(io, {
            operation,
            state: "refused",
            verifier_id: verifierId,
            operation_key: operationKey,
            next_action: "request_tenant_admission",
        }, [
            "Your organization does not currently have access to the private preview. Contact Millwork support to restore or request access, then try again.",
        ]);
        return 2;
    }
    if (error.failure === "request_refused") {
        const next = `millwork verifier ${command} --verifier-id ${verifierId} ${stopChoiceCommandFlags(args)}`;
        report(io, {
            operation,
            state: "refused",
            verifier_id: verifierId,
            operation_key: operationKey,
            next_action: "start_new_intent",
            next,
        }, [
            "The key-entry request was refused before the key could be saved. Check the entered value, then start a new operation with:",
            next,
        ]);
        return 2;
    }
    const next = intentContinueCommand(verifierId, operationKey);
    report(io, {
        operation,
        state: "unknown",
        verifier_id: verifierId,
        operation_key: operationKey,
        next_action: "continue",
        next,
    }, [
        "We could not confirm whether the key was saved. Do not enter it again. Wait, then continue this setup:",
        next,
    ]);
    return 2;
}
/** One logical operation identity per command. It is reused on every
 *  resume, while each HTTP attempt gets its own request key: repeating the
 *  original request would only replay its recorded response. */
function operationKey(args, command, verifierId) {
    const supplied = flag(args, "--intent-id") ?? flag(args, "--operation-key");
    if (supplied !== undefined) {
        if (!/^[A-Za-z0-9._:-]{1,256}$/.test(supplied))
            throw new VerifierLifecycleUsageError("--intent-id / --operation-key must be the value a previous command printed");
        return supplied;
    }
    return `verifier-${command}-${verifierId}-${randomUUID()}`;
}
function attemptKey(operation) {
    return `${operation}.attempt-${randomUUID()}`;
}
/** The authoritative read for an operation; undefined when the read itself
 *  failed, which proves nothing either way. */
async function readBack(solver, verifierId, key) {
    try {
        return await solver.verifierConnection.inspect(verifierId, { operationKey: key });
    }
    catch {
        return undefined;
    }
}
function lastOperation(view) {
    const last = view?.last_operation;
    if (!last || last.status !== undefined || typeof last.kind !== "string")
        return undefined;
    return { kind: last.kind, phase: last.phase ?? null, state: last.resulting_state ?? {} };
}
function committedOperation(view, kind) {
    const last = lastOperation(view);
    if (!last || last.kind !== kind || last.phase !== "committed")
        return undefined;
    const handle = last.state.handle;
    const replaced = last.state.replaced_handle;
    return { handle: typeof handle === "string" ? handle : null, replacedHandle: typeof replaced === "string" ? replaced : null };
}
function unreadable(view) {
    return view === undefined || view.status === "unknown" || view.last_operation?.status === "unknown";
}
/** Present-tense claims ("Millwork now uses this key", its stop time) are
 *  made only when the current read shows exactly that key active. */
function currentlyInUse(view, handle) {
    return Boolean(view && handle && view.status === "active" && view.handle === handle);
}
function stopLine(view) {
    if (!view.stop_at)
        return "No Millwork stop date.";
    const remaining = view.days_remaining !== null && view.days_remaining !== undefined
        ? ` · ${view.days_remaining} ${view.days_remaining === 1 ? "day" : "days"} remaining`
        : "";
    return `Millwork will stop using this key at ${view.stop_at} (${view.stop_time_zone ?? "UTC"})${remaining}.`;
}
function shortHandle(handle) {
    return handle.length > 16 ? `${handle.slice(0, 14)}…` : handle;
}
/** The stored-copy state of one key, only from the returned records (C9):
 *  removal scheduled and removed stay distinct, and nothing is inferred. */
function cleanupLine(view, handle, label) {
    if (!view || !handle)
        return undefined;
    const record = view.retired_keys?.find((key) => key.handle === handle);
    if (!record)
        return undefined;
    return cleanupRecordLine(record, label);
}
function cleanupRecordLine(record, label) {
    return record.state === "destroyed"
        ? `${label} ${shortHandle(record.handle)}: Stored key removed${record.destroyed_at ? ` at ${record.destroyed_at}` : ""}.`
        : `${label} ${shortHandle(record.handle)}: Stored key removal scheduled.`;
}
/** Prefer an exact known handle. When recovery cannot identify the stopped key,
 *  render returned records as earlier keys without guessing their relationship
 *  to the operation. */
function cleanupLines(view, handle, exactLabel) {
    const exact = cleanupLine(view, handle, exactLabel);
    if (exact)
        return [exact];
    return view?.retired_keys?.map((record) => cleanupRecordLine(record, "Earlier key")) ?? [];
}
/** What the current read shows, for a key other than the one just handled. */
function currentStateLine(view) {
    if (unreadable(view))
        return "Current access could not be confirmed.";
    switch (view.status) {
        case "active":
            return "Millwork is still using the previous key.";
        case "expired":
            return view.stop_at
                ? `Millwork stopped using the previous key at ${view.stop_at}.`
                : "The previous key's stop date has passed. Millwork has stopped using it.";
        case "revoked":
            return "Millwork has stopped using the previous key.";
        case "unbound":
            return "No key is connected yet.";
        default:
            return `Current state: ${view.status}.`;
    }
}
function intentContinueCommand(verifierId, intentId) {
    return `millwork verifier continue --verifier-id ${verifierId} --intent-id ${intentId}`;
}
function continueCommand(verifierId, key, handle) {
    return `millwork verifier continue --verifier-id ${verifierId} --operation-key ${key}${handle ? ` --handle ${handle}` : ""}`;
}
function disconnectCommand(verifierId, key) {
    return `millwork verifier disconnect --verifier-id ${verifierId} --yes --operation-key ${key}`;
}
/** A confirmed failure needs a new attempt, never the old continuation (the
 *  failed key is already scheduled for removal). */
function newAttempt(view, verifierId) {
    if (view.status === "active")
        return { action: "new_replacement", command: `millwork verifier replace --verifier-id ${verifierId} --stop-days <30|90|180|365|0>` };
    if (view.status === "revoked" || view.status === "expired")
        return { action: "restore", command: `millwork verifier restore --verifier-id ${verifierId} --stop-days <30|90|180|365|0>` };
    return { action: "connect", command: `millwork verifier connect --verifier-id ${verifierId}` };
}
function reportUnknown(io, operation, verifierId, key, next, view) {
    report(io, { operation, state: "unknown", verifier_id: verifierId, operation_key: key, next_action: "resume", next, connection: view ?? null }, [
        "We have not confirmed whether this completed. Check the existing operation before trying again:",
        next,
    ]);
    return 2;
}
/** A promotion that committed: the outcome is historical; what is in use now
 *  is reported only from the current read. A replacement always keeps its
 *  endpoint clean-up step and the earlier key's stored-copy state. */
function reportPromoted(io, operation, verifierId, key, handle, replacedHandle, view) {
    const document = { operation, state: "done", verifier_id: verifierId, operation_key: key, promoted_handle: handle, replaced_handle: replacedHandle, connection: view ?? null };
    const cleanup = cleanupLine(view, replacedHandle, "Earlier key");
    const endpointSteps = replacedHandle ? [ENDPOINT_DENIAL, ...(cleanup ? [cleanup] : [])] : [];
    if (currentlyInUse(view, handle)) {
        report(io, document, replacedHandle
            ? ["Key replaced. Millwork now uses the new key.", stopLine(view), ...endpointSteps]
            : ["Key connected. Millwork now uses this key.", stopLine(view)]);
        return 0;
    }
    report(io, document, [
        replacedHandle ? "The key replacement completed." : "The key change completed.",
        unreadable(view)
            ? "Current access could not be confirmed. Check the verifier before relying on it."
            : `The connection has changed since then. Current state: ${view.status}.`,
        ...endpointSteps,
    ]);
    return 0;
}
async function continuePending(solver, verifierId, args, io, operation) {
    const key = operationKey(args, "continue", verifierId);
    const named = flag(args, "--intent-id") !== undefined || flag(args, "--operation-key") !== undefined;
    const view = await readBack(solver, verifierId, key);
    const committed = committedOperation(view, "promote");
    // A resumed operation that already committed is reported, never repeated.
    if (committed)
        return reportPromoted(io, operation, verifierId, key, committed.handle, committed.replacedHandle, view);
    if (unreadable(view))
        return reportUnknown(io, operation, verifierId, key, continueCommand(verifierId, key, flag(args, "--handle") ?? null), view);
    const current = view;
    // The key this operation names: the one entered for its intent, or the
    // one a previous command printed. Never whichever key happens to be waiting.
    const last = lastOperation(current);
    const entered = last?.kind === "stage" && typeof last.state.handle === "string" ? last.state.handle : null;
    const intendedHandle = flag(args, "--handle") ?? entered;
    if (flag(args, "--intent-id") !== undefined && !intendedHandle) {
        report(io, { operation, state: "action_required", verifier_id: verifierId, operation_key: key, next_action: "enter_key", connection: current }, ["No key has been entered for this setup yet. Enter it on the private page first, then run this command again."]);
        return 2;
    }
    const pending = current.pending_key ?? null;
    if (pending && intendedHandle && pending.handle !== intendedHandle) {
        report(io, { operation, state: "changed", verifier_id: verifierId, operation_key: key, connection: current }, [
            "A different key is now waiting than the one this operation named. Check the verifier before continuing.",
        ]);
        return 2;
    }
    if (!pending || (named && !intendedHandle)) {
        if (intendedHandle && current.last_test?.outcome === "failed" && current.last_test.handle === intendedHandle) {
            return reportFailedTest(io, operation, verifierId, key, current);
        }
        report(io, { operation, state: "nothing_pending", verifier_id: verifierId, operation_key: key, connection: current }, ["No entered key is waiting for its test.", currentStateLine(current)]);
        return 2;
    }
    return testAndReport(solver, verifierId, { handle: pending.handle, captured_generation: pending.captured_generation }, current.status === "active" ? current.handle ?? null : null, io, operation, key);
}
function reportFailedTest(io, operation, verifierId, key, view) {
    const next = newAttempt(view, verifierId);
    const reason = failureCopy(view.last_test?.reason);
    const cleanup = cleanupLine(view, view.last_test?.handle ?? null, "Entered key");
    report(io, { operation, state: "test_failed", verifier_id: verifierId, operation_key: key, next_action: next.action, next: next.command, connection: view }, view.status === "active"
        ? ["Replacement failed. Your previous key is still selected.", reason, ...(cleanup ? [cleanup] : []), "Correct the endpoint or key, then start a new replacement and enter the key privately again:", next.command]
        : ["The key was not connected.", reason, ...(cleanup ? [cleanup] : []), "Correct the endpoint or key, then start again and enter the key privately:", next.command]);
    return 1;
}
async function testAndReport(solver, verifierId, staged, previousHandle, io, operation, key) {
    try {
        await solver.verifierConnection.testAndPromote(verifierId, staged, { operationKey: key, idempotencyKey: attemptKey(key) });
    }
    catch {
        // A lost or failed response proves nothing; the outcome is read back below.
    }
    const view = await readBack(solver, verifierId, key);
    const committed = committedOperation(view, "promote");
    if (committed || currentlyInUse(view, staged.handle)) {
        return reportPromoted(io, operation, verifierId, key, committed?.handle ?? staged.handle, committed?.replacedHandle ?? previousHandle, view);
    }
    const next = continueCommand(verifierId, key, staged.handle);
    if (unreadable(view))
        return reportUnknown(io, operation, verifierId, key, next, view);
    const current = view;
    // Only a failure custody recorded for this exact key is a proven failure.
    if (current.last_test?.outcome === "failed" && current.last_test.handle === staged.handle) {
        return reportFailedTest(io, operation, verifierId, key, current);
    }
    if (current.pending_key?.handle === staged.handle) {
        report(io, { operation, state: "pending", verifier_id: verifierId, operation_key: key, next_action: "resume", next, connection: current }, [
            "The new key is still waiting for its test. Continue this operation with:",
            next,
            currentStateLine(current),
        ]);
        return 2;
    }
    // Neither promoted, nor failed, nor still waiting: the connection changed
    // meanwhile. Report what is current, with no advice to retry.
    report(io, { operation, state: "changed", verifier_id: verifierId, operation_key: key, connection: current }, [
        `The new key is not the one in use, and the connection changed in the meantime. Current state: ${current.status}. Check the current state before changing anything else.`,
    ]);
    return 2;
}
async function disconnect(solver, verifierId, args, io) {
    const confirmed = args.includes("--yes")
        || (io.interactive && await io.confirm(`Stop Millwork using the key for ${verifierId}? It may still work at your endpoint. [y/N] `));
    if (!confirmed) {
        report(io, { operation: "verifier_disconnect", state: "action_required", verifier_id: verifierId, reason: "confirmation_required" }, ["Not disconnected. Pass --yes to confirm."]);
        return 2;
    }
    const key = operationKey(args, "disconnect", verifierId);
    // Read-only: which key is in use, so its stored-copy state can be reported
    // from the returned records afterwards. A failed read changes nothing.
    let activeHandle = null;
    try {
        const before = await solver.verifierConnection.inspect(verifierId);
        activeHandle = before.status === "active" ? before.handle ?? null : null;
    }
    catch {
        activeHandle = null;
    }
    try {
        await solver.verifierConnection.revoke(verifierId, { operationKey: key, idempotencyKey: attemptKey(key) });
    }
    catch {
        // A lost acknowledgement proves nothing; the operation is read back below.
    }
    const view = await readBack(solver, verifierId, key);
    const committed = committedOperation(view, "revoke");
    const cleanup = cleanupLines(view, activeHandle, "Key");
    if (view && view.status === "revoked" && !unreadable(view)) {
        report(io, { operation: "verifier_disconnect", state: "done", verifier_id: verifierId, operation_key: key, connection: view }, [
            "Millwork has stopped using this key. It may still work at your endpoint.",
            ENDPOINT_DENIAL.replace("The earlier key may still work at your endpoint. ", ""),
            ...cleanup,
        ]);
        return 0;
    }
    if (committed) {
        // The disconnect happened, but the current state is not (or no longer)
        // shown as disconnected: report the outcome and the current state apart.
        report(io, { operation: "verifier_disconnect", state: "done", verifier_id: verifierId, operation_key: key, connection: view ?? null }, [
            "The disconnect completed.",
            unreadable(view)
                ? "Current access could not be confirmed. Check the verifier before relying on it."
                : `The connection has changed since then. Current state: ${view.status}.`,
            ...cleanup,
        ]);
        return 0;
    }
    // Neither committed nor revoked: an absent operation cannot prove failure,
    // since the original may still commit.
    const next = disconnectCommand(verifierId, key);
    report(io, { operation: "verifier_disconnect", state: "unknown", verifier_id: verifierId, operation_key: key, next_action: "resume", next, connection: view ?? null }, [
        "We could not confirm whether Millwork stopped using this key. Check the connection before trying again:",
        next,
    ]);
    return 2;
}
