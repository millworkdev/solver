import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object")
        return `{${Object.entries(value)
            .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    return JSON.stringify(value);
}
const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
export const setupRequestHash = (request) => hash(request);
export class SetupRecoveryStorageError extends Error {
    constructor() { super("Saved setup recovery data is unavailable. Use your saved application ID or request key to recover this request."); }
}
const storageError = () => new SetupRecoveryStorageError();
function paths(scope, environment) {
    const homeDirectory = environment.HOME || environment.USERPROFILE;
    if (!homeDirectory)
        throw storageError();
    const binding = hash({ api: new URL(scope.apiBaseUrl).href.replace(/\/+$/, ""), principal: scope.principalId, key: scope.derivedKey });
    const parent = join(homeDirectory, ".millwork");
    const directory = join(parent, "setup-recovery");
    return { homeDirectory, parent, directory, binding, file: join(directory, `${binding}.json`) };
}
function isPrivate(stat) {
    return process.platform === "win32" || ((stat.mode & 0o077) === 0
        && (typeof process.getuid !== "function" || stat.uid === process.getuid()));
}
async function privateDirectory(path, create) {
    if (create)
        await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST")
            throw error; });
    try {
        const stat = await lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !isPrivate(stat))
            throw storageError();
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT" && !create)
            return false;
        throw error;
    }
}
/** No API keys, prompts or private URLs are stored. A scope gets one immutable
 * replacement identity; it is retained after success so replay stays replay. */
export async function loadSetupRecovery(scope, environment = process.env) {
    if (!environment.HOME && !environment.USERPROFILE)
        return undefined;
    const location = paths(scope, environment);
    try {
        try {
            await lstat(location.file);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return undefined;
            throw error;
        }
        if (!await privateDirectory(location.parent, false) || !await privateDirectory(location.directory, false))
            return undefined;
        const handle = await open(location.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(error => {
            if (error.code === "ENOENT")
                return undefined;
            throw error;
        });
        if (!handle)
            return undefined;
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || !isPrivate(stat) || stat.size < 1 || stat.size > 16_384)
                throw storageError();
            const record = JSON.parse(await handle.readFile("utf8"));
            if (record.schema_version !== 1 || record.scope_sha256 !== location.binding
                || typeof record.application_key !== "string" || !record.application_key.startsWith(`${scope.derivedKey}:new:`)
                || !/^[0-9a-f-]{36}$/.test(record.application_key.slice(`${scope.derivedKey}:new:`.length))
                || !record.request || typeof record.request.digest !== "string" || typeof record.request.issued_at !== "string"
                || !["starter", "pooled-open-model", "byok-open-model"].includes(record.request.template_id)
                || typeof record.request.write !== "boolean" || record.request_sha256 !== setupRequestHash(record.request))
                throw storageError();
            return record;
        }
        finally {
            await handle.close();
        }
    }
    catch {
        throw storageError();
    }
}
/** Publish a complete, fsynced record with an atomic no-replace hard link.
 * Concurrent processes either publish once or read the same winner. A partial
 * file is never visible at the stable path, and storage failure precedes apply. */
export async function claimSetupRecovery(scope, request, environment = process.env) {
    const existing = await loadSetupRecovery(scope, environment);
    if (existing)
        return existing;
    const location = paths(scope, environment);
    let temporary;
    try {
        await privateDirectory(location.parent, true);
        await privateDirectory(location.directory, true);
        const record = { schema_version: 1, scope_sha256: location.binding,
            request_sha256: setupRequestHash(request), application_key: `${scope.derivedKey}:new:${randomUUID()}`, request };
        temporary = join(location.directory, `.${randomUUID()}.tmp`);
        const handle = await open(temporary, "wx", 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(record)}\n`);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        try {
            await link(temporary, location.file);
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
        if (process.platform !== "win32") {
            // Persist newly created directory entries as well as the record link.
            for (const path of [location.directory, location.parent, location.homeDirectory]) {
                const directory = await open(path, "r");
                try {
                    await directory.sync();
                }
                finally {
                    await directory.close();
                }
            }
        }
        const saved = await loadSetupRecovery(scope, environment);
        if (!saved)
            throw storageError();
        return saved;
    }
    catch {
        throw storageError();
    }
    finally {
        if (temporary)
            await unlink(temporary).catch(() => undefined);
    }
}
export function setupRecoveryCommand(record) {
    const request = record.request;
    const choice = request.byok_offering;
    return ["millwork", "tenant", "start", "--template", request.template_id,
        "--idempotency-key", record.application_key, "--digest", request.digest, "--issued-at", request.issued_at,
        ...(request.model_deployment_id ? ["--model-deployment-id", request.model_deployment_id] : []),
        ...(choice ? ["--source-id", choice.source_id, "--served-variant-id", choice.served_variant_id,
            ...(choice.source_id === "aws_bedrock" ? ["--auth-scheme", choice.auth_scheme] : [])] : []),
        ...(request.write ? ["--write"] : []), "--json"];
}
