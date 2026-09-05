import { spawn } from "node:child_process";
import { win32 } from "node:path";
import { hostedConsentUrl } from "./tenantStartFlow.js";
import { terminalText } from "./tenantStartOutput.js";
// Browser helpers must not inherit the Solver credential, NODE_OPTIONS or a
// caller's shell-valued BROWSER override. Only desktop/session settings pass.
function desktopEnvironment(environment) {
    const allowed = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "DISPLAY",
        "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_CURRENT_DESKTOP", "XDG_CONFIG_HOME",
        "DBUS_SESSION_BUS_ADDRESS", "SystemRoot", "WINDIR", "USERPROFILE", "APPDATA",
        "LOCALAPPDATA", "TEMP", "TMP"];
    return Object.fromEntries(allowed.flatMap((key) => {
        const entry = Object.entries(environment).find(([name]) => name.toLowerCase() === key.toLowerCase());
        return entry?.[1] ? [[key, entry[1]]] : [];
    }));
}
/** Request the OS browser, not consent itself. Never execute a shell or log its errors. */
export async function openConsentBrowser(url, runtime = {}) {
    // Defence in depth: only the already-validated current hosted URL reaches here.
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash
            || url.length > 4096 || /\s|[\u0000-\u001f\u007f-\u009f]/u.test(url))
            return "unavailable";
        url = parsed.href;
    }
    catch {
        return "unavailable";
    }
    const platform = runtime.platform ?? process.platform;
    const environment = desktopEnvironment(runtime.environment ?? process.env);
    const windowsRoot = environment.SystemRoot ?? environment.WINDIR;
    // xdg-open's installation path varies across Linux distributions; resolve
    // that fixed executable through the user's PATH, never a BROWSER command.
    const command = platform === "darwin" ? "/usr/bin/open"
        : platform === "linux" ? "xdg-open"
            : platform === "win32" && windowsRoot && win32.isAbsolute(windowsRoot)
                ? win32.join(windowsRoot, "System32", "rundll32.exe") : undefined;
    if (!command)
        return "unavailable";
    const args = platform === "win32"
        ? [`${win32.join(windowsRoot, "System32", "url.dll")},FileProtocolHandler`, url] : [url];
    const timeoutMs = runtime.timeoutMs ?? 2_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000)
        return "unavailable";
    return new Promise((resolve) => {
        let settled = false;
        let child;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish("timed_out");
            // Some desktop helpers replace themselves with the browser process.
            // Stop observing, never kill that PID or an unrelated browser session.
            child?.unref();
        }, timeoutMs);
        try {
            child = (runtime.launch ?? spawn)(command, args, { shell: false, stdio: "ignore", windowsHide: true, env: environment });
            child.on("error", () => finish("failed"));
            child.once("close", (code) => finish(code === 0 ? "requested" : "failed"));
        }
        catch {
            finish("failed");
        }
    });
}
/** Presentation only: the existing application/resume API owns all progress. */
export function createConsentPresenter(options) {
    const environment = options.environment ?? process.env;
    const platform = options.platform ?? process.platform;
    let waitingApplication;
    const presented = new Set();
    // Keep our authored line structure (including the standalone fallback URL),
    // while still removing unsafe terminal controls.
    const write = (message) => options.write(terminalText(message, true));
    return {
        async presentConsent(application, suppliedUrl) {
            if (!options.interactive)
                return;
            const url = hostedConsentUrl(application);
            if (!url || url !== suppliedUrl || application.diagnostics.access_lane !== "byok"
                || application.diagnostics.commercial_owner !== "customer"
                || application.diagnostics.lane_substitution_performed !== false) {
                throw new Error("The hosted consent link is invalid. No browser was opened.");
            }
            const identity = JSON.stringify([application.application_id, application.consent.handoff_intent_id,
                application.consent.attempt, url]);
            if (presented.has(identity))
                return;
            presented.add(identity);
            waitingApplication = application.application_id;
            const remote = Boolean(environment.SSH_CONNECTION || environment.SSH_CLIENT || environment.SSH_TTY);
            const automated = Boolean(environment.CI && !["0", "false"].includes(environment.CI.toLowerCase()));
            const noDesktop = platform === "linux" && !environment.DISPLAY && !environment.WAYLAND_DISPLAY;
            if (options.noBrowser || remote || automated || noDesktop) {
                write("Browser opening skipped for this terminal. Open the consent link on your browser device.\n");
            }
            else {
                write("Opening your browser to connect your provider account…\n");
                let result;
                try {
                    result = await (options.openBrowser ?? ((value) => openConsentBrowser(value, { platform, environment })))(url);
                }
                catch {
                    result = "failed";
                }
                if (result !== "requested")
                    write("Could not confirm browser launch. Use the link below; this setup is still waiting.\n");
            }
            write(`Open this short-lived link if needed (on another device if this terminal is remote):\n${url}\n`);
            write(`In the browser, sign in and approve the provider connection, then return to this terminal.\nConsent link expires ${terminalText(application.consent.expires_at)}. Waiting for approval; keep this command running. Setup continues automatically when consent is received.\nDo not paste a provider key or authorization code into this terminal. Connecting the account does not authorize a paid model run; live execution requires separate approval after Echo.\n`);
        },
        progress(application) {
            if (options.interactive && application.application_id === waitingApplication
                && application.template_id === "byok-open-model" && application.source_connection_id
                && application.state !== "consent_pending") {
                write("Consent received. Continuing this same setup in the terminal.\n");
                waitingApplication = undefined;
            }
        },
    };
}
