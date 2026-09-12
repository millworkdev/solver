import { InspectionUsageError, readQualificationFromApiError } from "./cliInspection.js";
import { presentProviderConsent } from "./tenantConsentBrowser.js";
import { providerConsentAction, terminalText } from "./tenantStartOutput.js";
import { principalScopedIdempotencyKey } from "./tenantStartFlow.js";
const KEY_HELP = {
    openrouter: "https://openrouter.ai/keys",
    openai_direct: "https://help.openai.com/en/articles/9186755-managing-your-work-in-platform-with-projects",
    anthropic_direct: "https://platform.claude.com/docs/en/api/overview#prerequisites",
    gemini_developer_api: "https://ai.google.dev/gemini-api/docs/api-key",
    xai_direct: "https://docs.x.ai/console/faq/security",
    moonshot_direct: "https://platform.kimi.ai/docs/overview",
    deepseek_direct: "https://api-docs.deepseek.com/",
    fireworks: "https://app.fireworks.ai/settings/users/api-keys",
    aws_bedrock: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_use-resources.html",
};
/** Keep read failures separate from mutation/idempotency errors at the CLI boundary. */
export class ProviderInspectionError extends Error {
    qualification;
    constructor(qualification) {
        super("Provider inspection unavailable.");
        this.qualification = qualification;
    }
}
async function providerRead(request) {
    try {
        return await request;
    }
    catch (error) {
        const qualification = readQualificationFromApiError(error);
        if (qualification)
            throw new ProviderInspectionError(qualification);
        throw error;
    }
}
/** Parse before any request. No credential-valued command-line option exists. */
export function resolveProviderLifecycleCommand(args) {
    if (args[0] !== "provider" || !["list", "rotate", "disconnect"].includes(args[1]))
        return null;
    const kind = args[1];
    const start = kind === "list" ? 2 : 3;
    if (kind !== "list" && (!args[2] || args[2].startsWith("--")))
        throw new InspectionUsageError(`provider ${kind} requires an exact connection ID from provider list.`);
    const flags = new Map();
    const booleans = new Set(kind === "list" ? ["--json"] : kind === "disconnect" ? ["--json", "--yes"] : ["--json", "--yes", "--open-browser", "--no-browser"]);
    const values = new Set(kind === "rotate" ? ["--handoff-id", "--idempotency-key"] : kind === "disconnect" ? ["--idempotency-key"] : []);
    for (let i = start; i < args.length; i++) {
        const flag = args[i];
        if (flags.has(flag))
            throw new InspectionUsageError(`Duplicate argument: ${terminalText(flag)}`);
        if (booleans.has(flag))
            flags.set(flag, true);
        else if (values.has(flag) && args[i + 1] && !args[i + 1].startsWith("--"))
            flags.set(flag, args[++i]);
        else
            throw new InspectionUsageError(`Unknown argument or missing value: ${terminalText(flag)}`);
    }
    if (flags.has("--open-browser") && flags.has("--no-browser"))
        throw new InspectionUsageError("Choose --open-browser or --no-browser, not both.");
    if (flags.has("--handoff-id") && !flags.has("--idempotency-key"))
        throw new InspectionUsageError("Resume rotation with the original --idempotency-key printed by the command.");
    if (kind === "list")
        return { kind };
    return { kind, connectionId: args[2], yes: flags.has("--yes"), openBrowser: flags.has("--open-browser"), noBrowser: flags.has("--no-browser"),
        ...(flags.has("--handoff-id") ? { handoffId: flags.get("--handoff-id") } : {}),
        ...(flags.has("--idempotency-key") ? { idempotencyKey: flags.get("--idempotency-key") } : {}) };
}
function safeConnection(connection, deployments, arms) {
    const bound = deployments.filter(row => row.connection_id === connection.connection_id);
    const ids = new Set(bound.map(row => row.model_deployment_id));
    return { connection_id: connection.connection_id, source_id: connection.source_id,
        display_name: terminalText(connection.display_name), auth_scheme: connection.auth_scheme,
        status: connection.status, test_state: connection.test_state, test_error: connection.test_error,
        revoked_at: connection.revoked_at, binding_revision: connection.binding_revision,
        tested_binding_revision: connection.tested_binding_revision,
        deployments: bound.map(row => ({ model_deployment_id: row.model_deployment_id, model_key: row.model_key, status: row.status })),
        saved_models: arms.filter(arm => typeof arm.model_deployment_id === "string" && ids.has(arm.model_deployment_id))
            .map(arm => ({ arm_id: arm.arm_id, display_name: terminalText(arm.display_name), status: arm.status })) };
}
async function dependencies(solver) {
    const [deployments, first] = await Promise.all([solver.modelDeployments.list(), solver.arms.list({ kind: "model", limit: 100 })]);
    const arms = [...first.items];
    let page = first;
    const seen = new Set();
    while (page.nextCursor) {
        if (seen.has(page.nextCursor) || seen.size >= 100)
            throw new Error("Could not finish reading affected saved models. No connection was changed.");
        seen.add(page.nextCursor);
        const next = await page.next();
        if (!next)
            break;
        page = next;
        arms.push(...page.items);
    }
    return { deployments, arms };
}
const command = (args) => ({ command: ["millwork", ...args], npx_command: ["npx", "--yes", "@millwork/solver", ...args] });
const shellCommand = (args) => args.map(value => `'${value.replace(/'/g, "'\\''")}'`).join(" ");
function assertCustomer(connection, expectedId) {
    if (connection.connection_id !== expectedId || connection.access_lane !== "byok" || connection.commercial_owner !== "customer") {
        throw new Error("This is not the requested customer customer-owned connection. Nothing was changed.");
    }
}
function assertHandoff(intent, connection, handoffId) {
    if ((handoffId && intent.handoff_intent_id !== handoffId) || intent.source_id !== connection.source_id || intent.auth_scheme !== connection.auth_scheme) {
        throw new Error("The saved browser setup does not match this connection. Nothing was rotated.");
    }
}
/** Orchestrates the existing REST lifecycle; never stores a secret or starts an execution. */
export async function runProviderLifecycle(solver, input, ui) {
    if (input.kind === "list") {
        const [profiles, connections, { deployments, arms }] = await Promise.all([
            providerRead(solver.modelSourceProfiles.list()), providerRead(solver.sourceConnections.list()), providerRead(dependencies(solver))
        ]);
        // Revocation is not readiness. The server requires an active status, a
        // passed test, and a tested revision matching the current binding before
        // it will serve a task (byokApplicationService.ts:441-444, 664-669), so a
        // disabled or untested connection has revoked_at null and still cannot be
        // used. Saying "can serve a task" from revocation alone was wrong.
        const saved = connections.map(row => safeConnection(row, deployments, arms));
        const notReady = (row) => {
            if (row.status !== "active")
                return `status is ${row.status}`;
            if (row.test_state !== "passed")
                return `provider check is ${row.test_state ?? "untested"}`;
            if (row.tested_binding_revision !== row.binding_revision)
                return "the current credential has not passed a provider check";
            return null;
        };
        const live = saved.filter(row => !row.revoked_at);
        const ready = live.filter(row => !notReady(row));
        const blocked = live.filter(row => notReady(row))
            .map(row => ({ ...row, not_ready_reason: notReady(row) }));
        const disconnected = saved.filter(row => row.revoked_at)
            .map(row => ({ ...row, status_label: "disconnected -- not usable; kept for history" }));
        return { state: "inspected", available_providers: profiles.sources.map(row => ({ source_id: row.source_id,
                auth_schemes: row.auth_schemes.map(auth => auth.id), action: providerConsentAction(row.source_id).type })),
            ready_connections: ready,
            not_ready_connections: blocked,
            disconnected_connections: disconnected,
            existing_connections: saved,
            detail: `Choose from the providers listed for new setup. ${ready.length} connection(s) are ready to serve a task; `
                + `${blocked.length} are saved but not ready, each with its reason; ${disconnected.length} are disconnected and kept for history only. `
                + "Setup will check which models your provider account can use.",
            next_action: command(["tenant", "start", "--template", "byok-open-model"]) };
    }
    const connection = await providerRead(solver.sourceConnections.get(input.connectionId));
    assertCustomer(connection, input.connectionId);
    const { deployments, arms } = await providerRead(dependencies(solver));
    const summary = safeConnection(connection, deployments, arms);
    const aws = connection.source_id === "aws_bedrock" && connection.auth_scheme === "aws_sts_sigv4";
    const bedrockKey = connection.source_id === "aws_bedrock" && connection.auth_scheme === "api_key";
    const keyHelp = bedrockKey ? "https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html#api-keys-gen-short"
        : KEY_HELP[connection.source_id] ?? "https://docs.getmillwork.dev/help/provider-connections";
    const cleanup = aws
        ? "This connection and its saved models are disabled. Millwork has scheduled removal of the saved AWS credentials; removal is not yet confirmed. Calls already running may finish. Disconnecting does not end the session in AWS. No fallback model was selected. Choose another model before your next task if this was your current connection."
        : bedrockKey ? "This Bedrock connection and its saved models are disabled. Millwork has scheduled removal of the saved key; removal is not yet confirmed. Disconnecting does not revoke the key at AWS. Short-term keys expire with their AWS session limit. Calls already running may finish. No fallback model was selected. Choose another model before your next task if this was your current connection."
            : "This connection and its saved models are disabled. Millwork has scheduled removal of the saved key; removal is not yet confirmed. Revoke it at the provider too if needed. Calls already running may finish. No fallback model was selected. Choose another model before your next task if this was your current connection.";
    if (connection.revoked_at)
        return { state: "disconnected", connection: summary, detail: cleanup, provider_access_url: keyHelp };
    if (ui.interactive)
        ui.write(`Affected connection and saved models:\n${JSON.stringify(summary, null, 2)}\n`);
    const approved = input.yes || (ui.interactive && await ui.confirm(input.kind === "disconnect"
        ? `Disconnect ${terminalText(connection.source_id)} connection ${terminalText(connection.connection_id)}? This disables ${summary.deployments.length} deployments and ${summary.saved_models.length} saved models. Already-dispatched calls may finish. No fallback is selected. [y/N] `
        : aws
            ? `Renew AWS access for connection ${terminalText(connection.connection_id)}? Use a fresh temporary session for the same region and inference profile. Millwork checks it before switching. This does not approve a paid run. [y/N] `
            : bedrockKey ? `Renew Bedrock access for connection ${terminalText(connection.connection_id)}? Generate a short-term Bedrock API key for the same AWS account and region. Millwork finds the Global Opus 5 profile and checks it before switching. This does not approve a paid run. [y/N] `
                : `Replace access for ${terminalText(connection.source_id)} connection ${terminalText(connection.connection_id)}? The replacement must pass the provider check before switching. This does not approve a paid run. [y/N] `));
    if (!approved)
        return { state: "action_required", connection: summary,
            next_action: { type: "confirm_connection_change", ...command(["provider", input.kind, connection.connection_id,
                    ...(input.idempotencyKey ? ["--idempotency-key", input.idempotencyKey] : []), ...(input.handoffId ? ["--handoff-id", input.handoffId] : []), "--yes", "--json"]),
                detail: "Review this exact connection and affected saved models with the user before confirming. --yes approves only this credential operation, never paid execution." } };
    if (input.kind === "disconnect") {
        const ack = await solver.sourceConnections.revoke(connection.connection_id, { idempotencyKey: input.idempotencyKey ?? `provider-disconnect:${connection.connection_id}` });
        if (ack.connection_id !== connection.connection_id || !ack.revoked_at)
            throw new Error("Disconnect was not confirmed. Inspect provider list before retrying; do not assume removal completed.");
        return { state: "disconnected", connection: { connection_id: connection.connection_id, source_id: connection.source_id, status: ack.status, revoked_at: ack.revoked_at },
            affected_models_before_disconnect: { deployments: summary.deployments, saved_models: summary.saved_models },
            detail: cleanup, provider_access_url: keyHelp, next_action: command(["provider", "list", "--json"]) };
    }
    // A previously created handoff can finish even if new setup was subsequently hidden.
    if (!input.handoffId) {
        const profiles = await providerRead(solver.modelSourceProfiles.list());
        if (!profiles.sources.some(row => row.source_id === connection.source_id && row.auth_schemes.some(auth => auth.id === connection.auth_scheme))) {
            return { state: "action_required", connection: summary, detail: "New setup for this provider is not currently offered. Your existing binding was not changed. You can still inspect or disconnect it.", provider_access_url: keyHelp };
        }
    }
    // Per connection and binding revision, not per invocation. Retyping the same
    // command while a handoff is pending derives the same key and resumes it; a
    // completed rotation advances binding_revision, which retires the key so a
    // later deliberate rotation still starts fresh. A random key per run made the
    // documented "resumes rather than starting a second one" true only for the
    // users who pasted the continue line back.
    // Namespaced by authenticated principal. Connections are tenant-shared and
    // the ledger owns a tenant/key/endpoint tuple that rejects a different
    // principal fingerprint, so a key derived from connection state alone is
    // generated identically by a second member -- or by the same person after
    // rotating their Millwork key -- and refused before its handler runs. An
    // explicit --idempotency-key is left exactly as given: that is a replay
    // request, and its owner chose it.
    const operationKey = input.idempotencyKey ?? principalScopedIdempotencyKey((await providerRead(solver.account.get())).authenticated_principal_id ?? "", `provider-rotate:${connection.connection_id}:${connection.binding_revision}`);
    const baseArgs = ["provider", "rotate", connection.connection_id, "--idempotency-key", operationKey, "--yes"];
    // Print the replay key before a mutation so a lost start response is recoverable.
    ui.write(`Continue rotation: ${shellCommand(command(baseArgs).npx_command)}\n`);
    let intent = input.handoffId ? await providerRead(solver.sourceCredentialHandoffs.poll(input.handoffId))
        : await solver.sourceCredentialHandoffs.start({ sourceId: connection.source_id, authScheme: connection.auth_scheme }, { idempotencyKey: `${operationKey}:handoff` });
    assertHandoff(intent, connection, input.handoffId);
    if (input.handoffId && intent.state === "pending" && Date.parse(intent.expires_at) > Date.now()) {
        // GET deliberately omits the private URL. Replay only the original start
        // request, then bind its cached URL to the live polled identity and expiry.
        // Never adopt a different handoff or replace live state with a cached state.
        const recovered = await solver.sourceCredentialHandoffs.start({ sourceId: connection.source_id, authScheme: connection.auth_scheme }, { idempotencyKey: `${operationKey}:handoff` });
        assertHandoff(recovered, connection, input.handoffId);
        if (recovered.expires_at !== intent.expires_at) {
            throw new Error("The recovered browser setup has a different expiry. No browser was opened or connection rotated.");
        }
        intent = { ...intent, continue_url: recovered.continue_url };
    }
    const resume = command([...baseArgs, "--handoff-id", intent.handoff_intent_id]);
    const pending = () => ({ state: "action_required", connection: summary, human_handoff: {
            type: "human_browser_approval_required", action: providerConsentAction(connection.source_id, connection.auth_scheme).type,
            detail: providerConsentAction(connection.source_id, connection.auth_scheme).detail, source_id: connection.source_id,
            handoff_intent_id: intent.handoff_intent_id, expires_at: intent.expires_at,
            ...("continue_url" in intent ? { continue_url: intent.continue_url } : {}), ...resume,
        }, detail: "The replacement has not been installed. Complete the existing browser step, then run the continuation command. No paid run was started." });
    if (intent.state === "pending" && "continue_url" in intent) {
        const url = intent.continue_url;
        if (typeof url !== "string")
            throw new Error("The provider setup link is missing. Use the saved continuation command.");
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || url.length > 4096 || /\s|[\u0000-\u001f\u007f-\u009f]/u.test(url))
            throw new Error("The provider setup link is invalid. No browser was opened.");
        if (Date.parse(intent.expires_at) > Date.now()) {
            if (ui.interactive || input.openBrowser)
                await (ui.present ?? (value => presentProviderConsent(value, { interactive: ui.interactive, explicitOpenBrowser: input.openBrowser, noBrowser: input.noBrowser, write: ui.write })))({ sourceId: connection.source_id, authScheme: connection.auth_scheme, url, expiresAt: intent.expires_at });
        }
    }
    ui.write(`Continue this same handoff: ${shellCommand(resume.npx_command)}\n`);
    // A reused key replays the saved start response verbatim, which is the
    // state at first submission -- normally pending. Recover the live attempt
    // before deciding anything, or a retyped command reports action_required
    // for a handoff the user already completed in the browser, and keeps
    // replaying an expired one once its deadline passes.
    if (!input.handoffId && intent.state === "pending") {
        const live = await providerRead(solver.sourceCredentialHandoffs.poll(intent.handoff_intent_id));
        assertHandoff(live, connection, intent.handoff_intent_id);
        intent = { ...live, continue_url: intent.continue_url };
    }
    if (ui.interactive) {
        for (let polls = 0; intent.state === "pending" && Date.parse(intent.expires_at) > Date.now() && polls < (ui.maxPolls ?? 300); polls++) {
            await (ui.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(2_000);
            intent = await providerRead(solver.sourceCredentialHandoffs.poll(intent.handoff_intent_id));
            assertHandoff(intent, connection, resume.command.at(-1));
        }
    }
    if (intent.state === "pending" && Date.parse(intent.expires_at) > Date.now())
        return pending();
    // Terminal, by whichever route. A due intent is expired by the server on
    // read -- getSourceHandoffIntent expires pending AND completed intents past
    // their deadline before returning -- so the state that arrives here is
    // "expired", not "pending"; a cancelled or broker-failed browser flow is
    // "failed"; and a pending intent past our own clock is terminal too. All
    // three used to fall through to a bare `provider rotate`, which regenerates
    // the same operation key and fetches the same dead handoff forever.
    if (!["completed", "consumed"].includes(intent.state)) {
        // The fresh key is derived from the attempt being abandoned, so it is
        // distinct from it, identical across retypes of the printed command (a
        // lost response is still recoverable), and advances on its own if this
        // attempt also dies -- the next handoff has a different id. It carries the
        // current principal namespace, because an explicit key is sent verbatim
        // and an un-namespaced one is refused by the principal-bound ledger.
        const freshKey = principalScopedIdempotencyKey((await providerRead(solver.account.get())).authenticated_principal_id ?? "", `provider-rotate:${connection.connection_id}:${connection.binding_revision}:after:${intent.handoff_intent_id}`);
        const ended = intent.state === "failed" ? "did not finish" : "expired before it was completed";
        return { state: "action_required", connection: summary,
            detail: aws
                ? `The browser step ${ended}. The replacement was not installed and your existing AWS access is unchanged. Start a fresh attempt with the command below; retyping the previous one asks about the same dead attempt. If the previous AWS session has expired, renew it before running another task.`
                : bedrockKey ? `The browser step ${ended}. The replacement was not installed and your existing Bedrock access is unchanged. Generate a short-term Bedrock key in the same AWS account and region, then start a fresh attempt with the command below.`
                    : `The browser step ${ended}. The replacement was not installed and your existing access is unchanged. Start a fresh attempt with the command below; retyping the previous one asks about the same dead attempt. A key already revoked at the provider will still need replacing.`,
            next_action: { type: "start_new_rotation", ...command(["provider", "rotate", connection.connection_id,
                    "--idempotency-key", freshKey, "--yes", "--json"]) },
            provider_access_url: keyHelp };
    }
    // A consumed handoff is not proof of success. Only the exact idempotent rotate response is.
    const rotated = await solver.sourceConnections.rotate(connection.connection_id, { handoffIntentId: intent.handoff_intent_id }, { idempotencyKey: `${operationKey}:replace` });
    assertCustomer(rotated, connection.connection_id);
    if (rotated.source_id !== connection.source_id || rotated.auth_scheme !== connection.auth_scheme
        || rotated.test_state !== "passed" || rotated.tested_binding_revision !== rotated.binding_revision || rotated.revoked_at) {
        throw new Error("Replacement access was not confirmed. Inspect provider list before retrying; no successful rotation is claimed.");
    }
    return { state: "rotated", connection: safeConnection(rotated, deployments, arms),
        detail: aws
            ? "Your new AWS session passed its check and is now in use. The connection and saved models stay the same. Millwork has scheduled removal of the old saved credentials. The old session expires at AWS at its original expiration time. Review any spending prompt before continuing a run. No paid run or model switch was started."
            : bedrockKey ? "Your new Bedrock key passed its check and is now in use. The connection, authentication method and saved models stay the same. Millwork uses the replacement for up to 12 hours from submission; AWS can expire it sooner. Millwork has scheduled removal of the old saved key, not revocation at AWS. Review any spending prompt before continuing a run. No paid run or model switch was started."
                : "Your replacement passed its check and is now in use. The connection and saved models stay the same. Millwork has scheduled removal of the old saved key; revoke it at the provider when ready. Review any new spending prompt before continuing a run. No paid run or model switch was started.",
        provider_access_url: keyHelp, next_action: command(["provider", "list", "--json"]) };
}
export function providerLifecycleSummary(document) {
    if (document.existing_connections) {
        const disconnected = (document.disconnected_connections ?? []);
        const blocked = (document.not_ready_connections ?? []);
        return `Available providers for new setup\n${JSON.stringify(document.available_providers, null, 2)}\n`
            + `Ready to serve a task\n${JSON.stringify(document.ready_connections, null, 2)}\n`
            + (blocked.length ? `Saved but not ready\n${JSON.stringify(blocked, null, 2)}\n` : "")
            + (disconnected.length
                ? `Disconnected (history only, not usable)\n${JSON.stringify(disconnected, null, 2)}\n`
                : "Disconnected (history only, not usable)\nnone\n")
            + `${document.detail}\n`;
    }
    return `${String(document.state)}\n${String(document.detail ?? "Review the connection before continuing.")}\n${JSON.stringify(document, null, 2)}\n`;
}
