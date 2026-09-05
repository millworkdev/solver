import { readFileSync } from "node:fs";
export const TENANT_START_DOCS_URL = "https://docs.getmillwork.dev/get-started/tenant-start?utm_source=millwork_cli&utm_medium=cli&utm_campaign=tenant_onramp";
export const DEFAULT_API_BASE_URL = "https://api.getmillwork.dev/v1";
export const TESTED_NODE_MAJORS = [20, 22];
function packageVersion() {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (manifest.name !== "@millwork/solver" || typeof manifest.version !== "string") {
        throw new Error("the CLI package identity is invalid");
    }
    return manifest.version;
}
function safeBaseUrl(value) {
    if (!value) {
        return { configured: false, valid: true, origin: DEFAULT_API_BASE_URL };
    }
    try {
        const parsed = new URL(value);
        const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
        const valid = (parsed.protocol === "https:" || localHttp)
            && parsed.username === ""
            && parsed.password === ""
            && parsed.search === ""
            && parsed.hash === "";
        return {
            configured: true,
            valid,
            origin: valid ? `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}` : null,
        };
    }
    catch {
        return { configured: true, valid: false, origin: null };
    }
}
export function buildDoctorReport(environment, nodeVersion = process.versions.node) {
    const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);
    const runtimeSupported = TESTED_NODE_MAJORS.includes(nodeMajor);
    const apiBase = safeBaseUrl(environment.SOLVERAPI_BASE_URL);
    const credentialConfigured = Boolean(environment.SOLVERAPI_API_KEY?.trim());
    const localConfigurationReady = runtimeSupported && apiBase.valid && credentialConfigured;
    return {
        schema_version: 1,
        command: "millwork doctor",
        package: {
            version: packageVersion(),
            supported_public_version: null,
            public_cli_available: false,
        },
        runtime: {
            node_version: nodeVersion,
            tested_majors: TESTED_NODE_MAJORS,
            supported: runtimeSupported,
        },
        configuration: {
            credential_configured: credentialConfigured,
            api_base_configured: apiBase.configured,
            api_base_valid: apiBase.valid,
            api_base: apiBase.origin,
        },
        documentation: {
            url: TENANT_START_DOCS_URL,
            referral_contains_user_identifier: false,
        },
        local_configuration_ready: localConfigurationReady,
        next_action: !runtimeSupported
            ? "Use Node.js 20 or 22, the tested CLI runtimes."
            : !apiBase.valid
                ? "Set SOLVERAPI_BASE_URL to an HTTPS URL or a loopback HTTP URL without credentials or query parameters."
                : !credentialConfigured
                    ? "Create your organization API key in the dashboard, then set SOLVERAPI_API_KEY without printing it."
                    : "Read the onramp before planning. Public registry installation remains unavailable until an exact supported version is published.",
    };
}
export function resolveDiscoveryCommand(args, environment = process.env, nodeVersion = process.versions.node) {
    const json = args.includes("--json");
    const invalidGrammar = (commandLength) => {
        const remainder = args.slice(commandLength);
        return remainder.length > 1 || (remainder.length === 1 && remainder[0] !== "--json");
    };
    const usageError = (usage) => ({
        exitCode: 2,
        stream: "stderr",
        text: JSON.stringify({ schema_version: 1, error: "invalid_arguments", usage }, null, 2),
    });
    if (args[0] === "docs") {
        if (invalidGrammar(1))
            return usageError("millwork docs [--json]");
        const value = { schema_version: 1, url: TENANT_START_DOCS_URL };
        return { exitCode: 0, stream: "stdout", text: json ? JSON.stringify(value, null, 2) : TENANT_START_DOCS_URL };
    }
    if (args[0] === "doctor") {
        if (invalidGrammar(1))
            return usageError("millwork doctor [--json]");
        const value = buildDoctorReport(environment, nodeVersion);
        return { exitCode: value.local_configuration_ready ? 0 : 1, stream: "stdout", text: JSON.stringify(value, null, 2) };
    }
    if (args[0] === "--version" || args[0] === "version") {
        if (invalidGrammar(1))
            return usageError("millwork --version [--json]");
        const version = packageVersion();
        const value = {
            schema_version: 1,
            package_version: version,
            supported_public_version: null,
            public_cli_available: false,
        };
        return {
            exitCode: 0,
            stream: "stdout",
            text: json ? JSON.stringify(value, null, 2) : `${version} (local candidate; no supported public CLI version)`,
        };
    }
    return null;
}
