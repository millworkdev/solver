import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { Solver } from "./client.js";
import { DEFAULT_API_BASE_URL, safeBaseUrl } from "./cliDiscovery.js";
import { API_KEYS_URL } from "./cliGuidance.js";
import { SolverApiError } from "./errors.js";
import { openOrganizationKeyBrowser } from "./tenantConsentBrowser.js";
const MAX_KEY_BYTES = 8 * 1024;
const MAX_BODY_BYTES = 10 * 1024;
const DEFAULT_LIFETIME_MS = 5 * 60 * 1_000;
const RECORD_NAME = "organization-key.json";
const LEGACY_NAME = "api_key";
function homeDirectory(environment) {
    const value = environment.HOME || environment.USERPROFILE;
    return value?.trim() || undefined;
}
function privatePaths(environment) {
    const home = homeDirectory(environment);
    if (!home)
        return null;
    const directory = join(home, ".millwork");
    return { directory, record: join(directory, RECORD_NAME), legacy: join(directory, LEGACY_NAME) };
}
function validKey(value) {
    return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_KEY_BYTES
        && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
async function privateRegularFile(path, platform, getUid) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_BODY_BYTES)
        return null;
    if (platform !== "win32") {
        const uid = getUid();
        if ((uid !== undefined && stat.uid !== uid) || (stat.mode & 0o077) !== 0)
            return null;
    }
    return stat;
}
function ownerUid() {
    return typeof process.getuid === "function" ? process.getuid() : undefined;
}
/** Load only an owner-private key bound to the exact intended API base. */
export async function loadStoredOrganizationKey(apiBaseUrl, options = {}) {
    const parsedBase = safeBaseUrl(apiBaseUrl);
    if (!parsedBase.valid || !parsedBase.origin)
        return undefined;
    const environment = options.environment ?? process.env;
    const platform = options.platform ?? process.platform;
    const getUid = options.getUid ?? ownerUid;
    const paths = privatePaths(environment);
    if (!paths)
        return undefined;
    try {
        if (await privateRegularFile(paths.record, platform, getUid)) {
            const value = JSON.parse(await readFile(paths.record, "utf8"));
            if (value.schema_version === 1 && value.api_base_url === parsedBase.origin && validKey(value.api_key)) {
                return value.api_key;
            }
        }
    }
    catch { /* Missing, malformed, or unsafe local state is never trusted. */ }
    // Backward compatibility for the old documented plain file is deliberately
    // limited to the production API, so it cannot be redirected to another host.
    if (parsedBase.origin !== DEFAULT_API_BASE_URL)
        return undefined;
    try {
        if (!await privateRegularFile(paths.legacy, platform, getUid))
            return undefined;
        const value = await readFile(paths.legacy, "utf8");
        return validKey(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
async function ensurePrivateDirectory(path, platform, getUid) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("unsafe local credential directory");
    if (platform !== "win32") {
        const uid = getUid();
        if (uid !== undefined && stat.uid !== uid)
            throw new Error("unsafe local credential directory owner");
        await chmod(path, 0o700);
    }
}
/** Atomically save one base-bound key without printing or returning its path. */
export async function saveOrganizationKey(apiKey, apiBaseUrl, options = {}) {
    if (!validKey(apiKey))
        throw new Error("invalid organization key");
    const parsedBase = safeBaseUrl(apiBaseUrl);
    if (!parsedBase.valid || !parsedBase.origin)
        throw new Error("invalid Millwork API base");
    const environment = options.environment ?? process.env;
    const platform = options.platform ?? process.platform;
    const getUid = options.getUid ?? ownerUid;
    const paths = privatePaths(environment);
    if (!paths)
        throw new Error("local credential storage is unavailable");
    await ensurePrivateDirectory(paths.directory, platform, getUid);
    const temporary = join(paths.directory, `.${RECORD_NAME}.${randomBytes(12).toString("hex")}.tmp`);
    const record = { schema_version: 1, api_base_url: parsedBase.origin, api_key: apiKey };
    let handle;
    try {
        handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        if (platform !== "win32")
            await chmod(temporary, 0o600);
        await rename(temporary, paths.record);
        if (platform !== "win32")
            await chmod(paths.record, 0o600);
    }
    catch (error) {
        await handle?.close().catch(() => undefined);
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
function securityHeaders(response) {
    response.setHeader("cache-control", "no-store, max-age=0");
    response.setHeader("pragma", "no-cache");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("connection", "close");
    response.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function sendHtml(response, status, body, done) {
    securityHeaders(response);
    response.statusCode = status;
    response.setHeader("content-type", "text/html; charset=utf-8");
    // The CLI-owned loopback origin cannot load the hosted provider assets. Keep
    // the existing provider-key handoff's DOM names, tokens, lockup, and action
    // treatment inline so this is the same established page pattern offline.
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Millwork</title><style>
    :root{color-scheme:light;--surface-0:#f7f6f3;--surface-1:#fdfdfb;--surface-2:#f0eeea;--border:#e1ded8;--border-strong:#c9c5bc;--ink-1:#211f1b;--ink-2:#5b564c;--brand:#c02a2a;--info:#33629f;--err:#ab2743;--radius:6px;--font-sans:system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:ui-monospace,"SF Mono",Menlo,monospace}
    *{box-sizing:border-box}html,body{min-width:320px;min-height:100%}body{min-height:100svh;margin:0;display:grid;grid-template-rows:64px minmax(0,1fr) 48px;color:var(--ink-1);background:var(--surface-0);font:15px/1.5 var(--font-sans)}a{color:inherit}.app-header{border-bottom:1px solid var(--border);background:var(--surface-1)}.app-header__inner,.page-footer__inner{width:min(1120px,calc(100% - 48px));height:100%;margin:0 auto;display:flex;align-items:center}.lockup{display:inline-flex;align-items:center;gap:10px}.lockup__mark{width:20px;height:20px}.lockup__word{font-size:17px;font-weight:600}.lockup__rule{width:1px;height:18px;background:var(--border)}.lockup__product,.label{font-family:var(--font-mono);font-weight:500}.lockup__product{font-size:11px}.label{font-size:13px;letter-spacing:.14em;text-transform:uppercase}main{width:min(1120px,calc(100% - 48px));margin:0 auto;padding:64px 0}.handoff{max-width:920px;margin:auto;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-1);overflow:hidden}.handoff__intro{padding:40px}.state-line{display:flex;gap:12px;align-items:center;margin:0 0 20px;color:var(--ink-2)}.state-line__mark{color:var(--info)}h1{font-size:36px;line-height:1.15;margin:0 0 20px}.lede,p{color:var(--ink-2);line-height:1.55}.lede{font-size:18px;max-width:760px}.notice{color:var(--err)}.credential-form{border-top:1px solid var(--border);padding:32px 40px 40px;display:grid;gap:14px}.credential-form label{font-size:17px;font-weight:600}.credential-form input{width:100%;min-height:52px;padding:12px;border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--surface-1);font:16px var(--font-sans)}.credential-form input:focus-visible,.button:focus-visible,a:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.form-hint{margin:0;font-size:14px}.actions{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-top:10px}.button{min-height:48px;padding:12px 20px;border:0;border-radius:var(--radius);background:var(--ink-1);color:#fff;font:600 16px var(--font-sans);cursor:pointer}.button--secondary{background:var(--surface-2);color:var(--ink-1);border:1px solid var(--border)}.text-link{color:#2f61a5;text-decoration:none}.assurance{margin:8px 0 0;font-size:14px}.assurance strong{color:var(--ink-1)}.page-footer{border-top:1px solid var(--border);color:var(--ink-2);font-size:12px}@media(max-width:767px){main{width:min(1120px,calc(100% - 28px));padding:28px 0}.handoff__intro,.credential-form{padding:24px}h1{font-size:30px}}
  </style></head><body><header class="app-header"><div class="app-header__inner"><div class="lockup" aria-label="Millwork Solver"><svg class="lockup__mark" viewBox="0 0 64 64" aria-hidden="true"><polygon points="10,10 32,10 27,54 10,54" fill="#c02a2a"></polygon><polygon points="38,16 54,16 54,60 33,60" fill="#c02a2a"></polygon></svg><span class="lockup__word">Millwork</span><span class="lockup__rule" aria-hidden="true"></span><span class="lockup__product">Solver</span></div></div></header><main><section class="handoff" aria-labelledby="page-title"><div class="handoff__intro">${body}</div></section></main><footer class="page-footer"><div class="page-footer__inner">© Thinking Oracle Inc.</div></footer></body></html>`, done);
}
const keyNotices = {
    invalid: "Enter a Millwork organization API key.",
    rejected: "This key wasn’t accepted. Check it in the Millwork dashboard and try again.",
    unavailable: "We couldn’t reach Millwork. Check your connection and try again.",
    save_failed: "Your key was accepted, but we couldn’t save it. Check that you can write to ~/.millwork and try again.",
};
function form(notice) {
    const messages = { ...keyNotices, rejected: keyNotices.rejected.replace("Millwork dashboard", `<a class="text-link" href="${API_KEYS_URL}" target="_blank" rel="noopener noreferrer">Millwork dashboard</a>`) };
    return `<p class="state-line label"><span class="state-line__mark" aria-hidden="true">◆</span><span>Setup</span></p><h1 id="page-title">Continue setup</h1><p class="lede">Enter a key from the organization you want to use.</p>${notice ? `<p class="notice" role="alert">${messages[notice]}</p>` : ""}<form class="credential-form" method="post" autocomplete="off"><label for="api_key">Millwork organization API key</label><input id="api_key" name="api_key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="8192"><p class="form-hint">Find or create a key in <a class="text-link" href="${API_KEYS_URL}" target="_blank" rel="noopener noreferrer">Millwork dashboard → API keys <span aria-hidden="true">↗</span></a>.</p><p class="form-hint">Your key will be saved on this computer for future commands.</p><div class="actions"><button class="button" name="action" value="save" type="submit">Save and continue <span aria-hidden="true">→</span></button><button class="button button--secondary" name="action" value="cancel" type="submit" formnovalidate>Cancel</button></div></form>`;
}
async function readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const value of request) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.length;
        if (size > MAX_BODY_BYTES)
            return null;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}
async function defaultValidation(apiKey, apiBaseUrl) {
    try {
        const solver = new Solver({ apiKey, baseUrl: apiBaseUrl, maxRetries: 0,
            fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
        const account = await solver.account.get();
        return typeof account.authenticated_principal_id === "string" && account.authenticated_principal_id.length > 0
            ? "accepted" : "unavailable";
    }
    catch (error) {
        return error instanceof SolverApiError && (error.status === 401 || error.status === 403)
            ? "rejected" : "unavailable";
    }
}
/**
 * Capture one organization key through a local single-use browser page. The
 * returned key remains process-local; the page, output, URL, and launcher never
 * contain it.
 */
export async function bootstrapOrganizationKey(options) {
    const parsedBase = safeBaseUrl(options.apiBaseUrl);
    if (!parsedBase.valid || !parsedBase.origin)
        return { state: "storage_unavailable" };
    const apiBaseUrl = parsedBase.origin;
    const lifetimeMs = options.lifetimeMs ?? DEFAULT_LIFETIME_MS;
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 100 || lifetimeMs > DEFAULT_LIFETIME_MS) {
        return { state: "storage_unavailable" };
    }
    const token = options.randomToken?.() ?? randomBytes(32).toString("base64url");
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token))
        return { state: "storage_unavailable" };
    const validateKey = options.validateKey ?? defaultValidation;
    const saveKey = options.saveKey ?? ((key, base) => saveOrganizationKey(key, base, options));
    const now = options.now ?? Date.now;
    const expiresAt = now() + lifetimeMs;
    return new Promise((resolve) => {
        let completed = false;
        let terminalIntent;
        let committed;
        let activeAttempt;
        let generation = 0;
        let responseHolds = 0;
        let expectedHost = "";
        let expectedOrigin = "";
        const path = `/organization-key/${token}`;
        let expiry;
        const settle = (result) => {
            if (completed)
                return;
            completed = true;
            if (expiry)
                clearTimeout(expiry);
            if (server.listening) {
                server.close(() => resolve(result));
                server.closeAllConnections();
            }
            else
                resolve(result);
        };
        const maybeSettle = () => {
            if (completed || activeAttempt || responseHolds > 0)
                return;
            if (committed)
                settle(committed);
            else if (terminalIntent)
                settle(terminalIntent);
        };
        const requestNoSaveSettlement = (result) => {
            if (completed || committed)
                return;
            terminalIntent ??= result;
            // Validation and request parsing are cancellable by generation. Once a
            // durable write begins it is not assumed abortable; settlement waits and
            // the write outcome becomes the truthful terminal result.
            if (activeAttempt?.phase === "validating")
                generation += 1;
            maybeSettle();
        };
        const sendHeldHtml = (response, status, body) => {
            responseHolds += 1;
            let released = false;
            const release = () => {
                if (released)
                    return;
                released = true;
                responseHolds -= 1;
                maybeSettle();
            };
            response.once("close", release);
            sendHtml(response, status, body, release);
        };
        const noSavePage = (state = terminalIntent?.state, storageMayCommit = activeAttempt?.phase === "storing") => storageMayCommit
            ? "<h1>Return to your terminal</h1><p>Check your terminal for the setup result.</p>"
            : state === "expired"
                ? "<h1>This setup link has expired</h1><p>Return to your terminal and run the setup command again.</p>"
                : "<h1>Setup cancelled</h1><p>You can close this tab. Run the setup command again when you’re ready.</p>";
        const terminalState = () => terminalIntent?.state;
        const attemptIsOpen = (attempt) => {
            if (attempt.phase === "validating" && now() >= expiresAt) {
                requestNoSaveSettlement({ state: "expired" });
            }
            return !completed && !terminalIntent && activeAttempt === attempt
                && attempt.generation === generation;
        };
        const server = createServer(async (request, response) => {
            try {
                if (completed || request.headers.host !== expectedHost || request.url !== path) {
                    sendHtml(response, 404, "<h1>This setup is not available</h1><p>Return to the terminal and start again.</p>");
                    return;
                }
                if (committed) {
                    sendHeldHtml(response, 200, "<h1>Return to your terminal</h1><p>Your key is saved. Setup will continue there. You can close this tab.</p>");
                    return;
                }
                if (now() >= expiresAt && !committed) {
                    sendHeldHtml(response, 410, noSavePage("expired"));
                    requestNoSaveSettlement({ state: "expired" });
                    return;
                }
                if (terminalIntent) {
                    sendHeldHtml(response, 409, noSavePage());
                    return;
                }
                if (request.method === "GET") {
                    sendHtml(response, 200, form());
                    return;
                }
                const fetchSite = request.headers["sec-fetch-site"];
                const validOrigin = request.headers.origin === expectedOrigin
                    || (request.headers.origin === "null" && fetchSite === "same-origin");
                if (request.method !== "POST"
                    || !validOrigin
                    || (fetchSite !== undefined && fetchSite !== "same-origin")
                    || !String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
                    sendHtml(response, 403, "<h1>Request refused</h1><p>Return to the original local setup page.</p>");
                    return;
                }
                const body = await readBody(request);
                // Body parsing is an async boundary. A cancel, expiry, or browser
                // failure that crossed it must win before this request can own a key.
                if (completed) {
                    if (!response.headersSent)
                        sendHtml(response, 404, "<h1>This setup is not available</h1><p>Return to the terminal and start again.</p>");
                    return;
                }
                if (now() >= expiresAt && !committed) {
                    sendHeldHtml(response, 410, noSavePage("expired"));
                    requestNoSaveSettlement({ state: "expired" });
                    return;
                }
                if (terminalIntent) {
                    sendHeldHtml(response, 409, noSavePage());
                    return;
                }
                if (body === null) {
                    sendHtml(response, 413, "<h1>Request too large</h1><p>Return to the terminal and start again.</p>");
                    return;
                }
                const fields = new URLSearchParams(body);
                const actions = fields.getAll("action");
                if (actions.length === 1 && actions[0] === "cancel") {
                    const storageIsFinishing = activeAttempt?.phase === "storing";
                    sendHeldHtml(response, 200, noSavePage("cancelled", storageIsFinishing));
                    requestNoSaveSettlement({ state: "cancelled" });
                    return;
                }
                const keys = fields.getAll("api_key");
                const apiKey = keys.length === 1 ? keys[0] : undefined;
                if (actions.length !== 1 || actions[0] !== "save") {
                    sendHtml(response, 400, form("invalid"));
                    return;
                }
                if (typeof apiKey !== "string" || !validKey(apiKey)) {
                    sendHtml(response, 400, form("invalid"));
                    return;
                }
                if (activeAttempt) {
                    sendHtml(response, 409, "<h1>A key check is already running</h1><p>Wait for that attempt to finish before trying another key.</p>");
                    return;
                }
                const attempt = { generation, phase: "validating" };
                activeAttempt = attempt;
                try {
                    let validation;
                    try {
                        validation = await validateKey(apiKey, apiBaseUrl);
                    }
                    catch {
                        validation = "unavailable";
                    }
                    // Validation is an async boundary. Never begin storage unless this
                    // attempt still owns the unchanged, open lifecycle generation.
                    if (!attemptIsOpen(attempt)) {
                        sendHeldHtml(response, terminalState() === "expired" ? 410 : 409, noSavePage(terminalState(), false));
                        return;
                    }
                    if (validation !== "accepted") {
                        sendHtml(response, validation === "rejected" ? 401 : 503, form(validation === "rejected" ? "rejected" : "unavailable"));
                        return;
                    }
                    if (!attemptIsOpen(attempt)) {
                        sendHeldHtml(response, terminalState() === "expired" ? 410 : 409, noSavePage(terminalState(), false));
                        return;
                    }
                    attempt.phase = "storing";
                    let saveFailed = false;
                    try {
                        await saveKey(apiKey, apiBaseUrl);
                    }
                    catch {
                        saveFailed = true;
                    }
                    // Storage is not presumed abortable. Its completed outcome wins over
                    // a cancel/expiry request that arrived after the durable write began.
                    if (!saveFailed) {
                        committed = { state: "configured", apiKey };
                        sendHeldHtml(response, 200, "<h1>Return to your terminal</h1><p>Your key is saved. Setup will continue there. You can close this tab.</p>");
                        return;
                    }
                    if (terminalState()) {
                        sendHeldHtml(response, terminalState() === "expired" ? 410 : 409, noSavePage(terminalState(), false));
                        return;
                    }
                    sendHtml(response, 500, form("save_failed"));
                }
                finally {
                    if (activeAttempt === attempt)
                        activeAttempt = undefined;
                    maybeSettle();
                }
            }
            catch {
                if (!response.headersSent)
                    sendHtml(response, 500, "<h1>Setup did not complete</h1><p>Return to the terminal and try again.</p>");
                else
                    response.destroy();
            }
        });
        server.maxHeadersCount = 32;
        server.headersTimeout = 5_000;
        server.requestTimeout = 10_000;
        server.keepAliveTimeout = 1_000;
        server.on("clientError", (_error, socket) => socket.destroy());
        server.once("error", () => requestNoSaveSettlement({ state: "storage_unavailable" }));
        server.listen(0, "127.0.0.1", async () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                requestNoSaveSettlement({ state: "storage_unavailable" });
                return;
            }
            expectedHost = `127.0.0.1:${address.port}`;
            expectedOrigin = `http://${expectedHost}`;
            const url = `${expectedOrigin}${path}`;
            const remainingLifetime = expiresAt - now();
            if (remainingLifetime <= 0) {
                requestNoSaveSettlement({ state: "expired" });
                return;
            }
            expiry = setTimeout(() => requestNoSaveSettlement({ state: "expired" }), remainingLifetime);
            try {
                options.onListening?.(url);
            }
            catch {
                requestNoSaveSettlement({ state: "storage_unavailable" });
                return;
            }
            let launch;
            try {
                launch = await (options.openBrowser ?? ((target) => openOrganizationKeyBrowser(target, { platform: options.platform, environment: options.environment })))(url);
            }
            catch {
                launch = "failed";
            }
            // Browser launch is an async boundary; an already completed form or
            // expired listener must not be replaced with a launch failure.
            if (completed || committed)
                return;
            if (now() >= expiresAt) {
                requestNoSaveSettlement({ state: "expired" });
                return;
            }
            // Some desktop helpers replace themselves with the browser and outlive
            // the observation window. A bounded timeout is therefore not evidence
            // that the page failed to open; keep the already-bounded listener alive.
            if (launch !== "requested" && launch !== "timed_out")
                requestNoSaveSettlement({ state: "browser_unavailable" });
        });
    });
}
/** The explicit local terminal alternative shares the browser's check and record. */
export async function bootstrapOrganizationKeyInTerminal(options) {
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const base = safeBaseUrl(options.apiBaseUrl);
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function" || !base.valid || !base.origin) {
        return { state: "storage_unavailable" };
    }
    const write = options.write ?? ((message) => { process.stderr.write(message); });
    // Readline owns raw mode, but every edit/redraw goes to a sink: neither the
    // terminal driver nor readline may echo a credential, including pasted input.
    const wasRaw = input.isRaw;
    const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const reader = createInterface({ input, output: muted, terminal: true, historySize: 0 });
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort();
    reader.on("SIGINT", cancel);
    reader.on("close", cancel);
    process.on("SIGINT", cancel);
    try {
        while (!cancellation.signal.aborted) {
            const answer = reader.question("", { signal: cancellation.signal });
            write("Millwork organization API key (hidden; Enter to cancel): ");
            let apiKey;
            try {
                apiKey = await answer;
            }
            catch {
                return { state: "cancelled" };
            }
            write("\n");
            if (!apiKey || cancellation.signal.aborted)
                return { state: "cancelled" };
            if (!validKey(apiKey)) {
                write(`${keyNotices.invalid}\n`);
                continue;
            }
            write("Checking your Millwork key…\n");
            let validation;
            try {
                validation = await (options.validateKey ?? defaultValidation)(apiKey, base.origin);
            }
            catch {
                validation = "unavailable";
            }
            // Ctrl+C during the account call must win before any durable write.
            if (cancellation.signal.aborted)
                return { state: "cancelled" };
            if (validation === "rejected") {
                write(`${keyNotices.rejected}\n`);
                continue;
            }
            if (validation !== "accepted") {
                write(`${keyNotices.unavailable}\n`);
                return { state: "validation_unavailable" };
            }
            // As with the browser path, once atomic storage begins, report its actual
            // outcome; a later interrupt cannot truthfully claim no key was saved.
            try {
                await (options.saveKey ?? ((key, url) => saveOrganizationKey(key, url, options)))(apiKey, base.origin);
            }
            catch {
                write(`${keyNotices.save_failed}\n`);
                return { state: "storage_unavailable" };
            }
            return { state: "configured", apiKey };
        }
        return { state: "cancelled" };
    }
    finally {
        reader.close();
        process.removeListener("SIGINT", cancel);
        input.setRawMode(wasRaw);
        muted.destroy();
    }
}
