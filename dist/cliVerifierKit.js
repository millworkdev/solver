import { access, copyFile, lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InspectionUsageError } from "./cliInspection.js";
import { terminalText } from "./tenantStartOutput.js";
export const VERIFIER_KIT_OUTPUT_VERSION = "millwork.verifier-kit.v1";
export const MAINTAINED_KIT_FILES = [
    "handler.mjs",
    "compatibility-kit.mjs",
    "check-endpoint.mjs",
    "listing-example-check.mjs",
    "minimal-output-check.mjs",
    "recipe-a-structured-output.mjs",
    "recipe-b-semantic-judgment.mjs",
    "recipe-c-evaluator-adapter.mjs",
    "recipe-d-completion-evidence.mjs",
    "selected-check.mjs",
    "existing-node-app.mjs",
    "minimal-node-dock.mjs",
    "minimal-python-dock.py",
    "README.md",
    "DEPLOYMENT_RECIPE.md",
];
export const RECIPE_CHECK_FILES = Object.freeze({
    default: "listing-example-check.mjs",
    "0": "minimal-output-check.mjs",
    a: "recipe-a-structured-output.mjs",
    b: "recipe-b-semantic-judgment.mjs",
    c: "recipe-c-evaluator-adapter.mjs",
    d: "recipe-d-completion-evidence.mjs",
});
const CREDENTIAL_ARGUMENT = /^--(key|token|secret|password|bearer|api-key|credential)/i;
const RECIPE_FILE = "DEPLOYMENT_RECIPE.md";
const SELECTED_CHECK_FILE = "selected-check.mjs";
function flagValue(args, name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}
function hasFlag(args, name) {
    return args.includes(name);
}
function emitJson(value) {
    process.stdout.write(`${JSON.stringify({ ...value, schema_version: VERIFIER_KIT_OUTPUT_VERSION }, null, 2)}\n`);
}
/**
 * Lexical containment is not containment. `link/kit` resolves inside the
 * workspace as text while `link` itself can point anywhere on the filesystem,
 * so comparing resolved strings let both init and --check reach outside the
 * directory the customer is standing in.
 *
 * Every existing component of the path is inspected with lstat, which reports
 * a symbolic link as a link instead of following it -- including a dangling
 * one. A link anywhere on the path refuses; components that do not exist yet
 * cannot be links, and init creates them itself.
 */
async function assertInsideWorkspace(cwd, requestedPath, refusal) {
    const root = await realpath(resolve(cwd));
    const target = resolve(root, requestedPath);
    const within = relative(root, target);
    if (target !== root && (within.startsWith("..") || isAbsolute(within))) {
        throw new InspectionUsageError(refusal);
    }
    let current = root;
    for (const segment of within.split(sep).filter((part) => part.length > 0)) {
        current = join(current, segment);
        let entry;
        try {
            entry = await lstat(current);
        }
        catch {
            break; // The remainder does not exist yet, so it cannot be a link.
        }
        if (entry.isSymbolicLink())
            throw new InspectionUsageError(refusal);
    }
    return target;
}
async function directoryHoldsKit(candidate) {
    try {
        for (const file of MAINTAINED_KIT_FILES) {
            await access(join(candidate, file), fsConstants.R_OK);
        }
        return true;
    }
    catch {
        return false;
    }
}
/** The kit shipped inside this package. An installed customer has no Millwork
 *  checkout, so this is the only copy they can be handed. */
export function installedKitRoot() {
    return join(dirname(fileURLToPath(import.meta.url)), "kit");
}
export async function findMaintainedKitRoot(startDirectories) {
    const shipped = installedKitRoot();
    if (await directoryHoldsKit(shipped))
        return shipped;
    for (const start of startDirectories) {
        let current = resolve(start);
        for (let depth = 0; depth < 10; depth += 1) {
            const candidate = join(current, "examples", "output-check-handler");
            try {
                await access(join(candidate, "handler.mjs"), fsConstants.R_OK);
                await access(join(candidate, "compatibility-kit.mjs"), fsConstants.R_OK);
                await access(join(candidate, RECIPE_FILE), fsConstants.R_OK);
                return candidate;
            }
            catch {
                const parent = dirname(current);
                if (parent === current)
                    break;
                current = parent;
            }
        }
    }
    throw new InspectionUsageError("This copy of the Millwork CLI does not carry the maintained output-check adapter. Reinstall the published package, or run the command from a directory that already contains the adapter files.");
}
/** POSIX-quote a path so a destination with a space stays one argument. */
function shellPath(path) {
    return /^[A-Za-z0-9._\/-]+$/.test(path) ? path : `'${path.split("'").join(`'\\''`)}'`;
}
async function resolveInitDirectory(cwd, args) {
    const flagged = flagValue(args, "--directory");
    const positional = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
    if (flagged && positional && flagged !== positional) {
        throw new InspectionUsageError("Pass the destination once: verifier init <directory> or --directory <directory>.");
    }
    const requested = flagged ?? positional ?? "output-check-handler";
    const refusal = "verifier init writes only a relative directory inside the current workspace, and never through a symbolic link. Choose a plain name inside it, for example: millwork verifier init kit";
    if (requested.includes("\0") || requested.split(/[/\\]/).includes("..") || isAbsolute(requested)) {
        throw new InspectionUsageError(refusal);
    }
    return assertInsideWorkspace(cwd, requested, refusal);
}
async function copyMaintainedKit(sourceRoot, destination, selectedCheck) {
    const collisions = [];
    const links = [];
    for (const file of MAINTAINED_KIT_FILES) {
        const target = join(destination, file);
        try {
            // lstat, not access: access follows a symbolic link and reports a
            // dangling one as missing, so the copy that followed created the link's
            // target -- outside the workspace, with the destination directory itself
            // perfectly legitimate. A link here is refused whether it dangles or not.
            const entry = await lstat(target);
            if (entry.isSymbolicLink())
                links.push(file);
            else
                collisions.push(file);
        }
        catch (error) {
            // Only "it is not there" is a write path. Anything else (a permission
            // error, a broken parent) fails closed rather than being read as absence.
            if (error.code !== "ENOENT") {
                throw new InspectionUsageError(`Could not inspect ${file} in the destination, so nothing was written. Choose an empty directory, for example: millwork verifier init kit`);
            }
        }
    }
    if (links.length > 0) {
        throw new InspectionUsageError(`Refusing to write through a symbolic link: ${links.join(", ")}. A link here would put the file wherever it points. Choose an empty directory, for example: millwork verifier init kit`);
    }
    if (collisions.length > 0) {
        throw new InspectionUsageError(`Refusing to overwrite existing kit files: ${collisions.join(", ")}. Choose an empty directory.`);
    }
    await mkdir(destination, { recursive: true });
    const written = [];
    try {
        for (const file of MAINTAINED_KIT_FILES) {
            // Exclusive creation: whatever appears between the check above and this
            // write -- a link, a file -- the copy fails instead of following it.
            if (file === SELECTED_CHECK_FILE) {
                // The exported kit carries the default selector; init writes one
                // deterministic selector for the requested overlay. No generated
                // module path comes from free-form user input.
                await writeFile(join(destination, file), `/** The check deployed by this kit. \`millwork verifier init --recipe\` writes the selected overlay here. */\n`
                    + `export { runHardCheck, scoreQuality, labelledCases } from "./${selectedCheck}";\n`, { flag: "wx" });
            }
            else {
                await copyFile(join(sourceRoot, file), join(destination, file), fsConstants.COPYFILE_EXCL);
            }
            written.push(file);
        }
    }
    catch (error) {
        // Leave no half-written kit behind: a customer would otherwise be told
        // nothing was written while holding some of it.
        for (const file of written)
            await rm(join(destination, file), { force: true });
        throw new InspectionUsageError(`Could not write ${destination}: ${error.code ?? "unknown error"}. Nothing was left behind. Choose an empty directory, for example: millwork verifier init kit`);
    }
    return written;
}
async function runVerifierInit(args, cwd, interactive) {
    if (hasFlag(args, "--local") || hasFlag(args, "--check") || hasFlag(args, "--access")) {
        throw new InspectionUsageError("verifier init only writes the maintained adapter. Use verifier test --local after the files exist.");
    }
    for (const argument of args.slice(2)) {
        if (CREDENTIAL_ARGUMENT.test(argument)) {
            throw new InspectionUsageError("Keys are not accepted as arguments. verifier init copies the maintained adapter and writes no secret.");
        }
        if (argument.startsWith("--") && argument !== "--directory" && argument !== "--recipe" && argument !== "--json") {
            throw new InspectionUsageError(`unknown argument: ${terminalText(argument)}`);
        }
    }
    if (hasFlag(args, "--directory") && (!flagValue(args, "--directory") || flagValue(args, "--directory").startsWith("--"))) {
        throw new InspectionUsageError("--directory requires a relative path");
    }
    if (hasFlag(args, "--recipe") && (!flagValue(args, "--recipe") || flagValue(args, "--recipe").startsWith("--"))) {
        throw new InspectionUsageError("--recipe requires default, 0, a, b, c or d");
    }
    const requestedRecipe = (flagValue(args, "--recipe") ?? "default").toLowerCase();
    if (!Object.hasOwn(RECIPE_CHECK_FILES, requestedRecipe)) {
        throw new InspectionUsageError("--recipe must be default, 0, a, b, c or d");
    }
    const selectedRecipe = requestedRecipe;
    const selectedCheck = RECIPE_CHECK_FILES[selectedRecipe];
    const destination = await resolveInitDirectory(cwd, args);
    const sourceRoot = await findMaintainedKitRoot([dirname(fileURLToPath(import.meta.url)), cwd]);
    const written = await copyMaintainedKit(sourceRoot, destination, selectedCheck);
    const relativeDirectory = relative(cwd, destination) || ".";
    // One runnable command. A destination with a space stays one argument, and
    // no sentence is fused to the end of it.
    const nextCommand = `cd ${shellPath(relativeDirectory)} && millwork verifier test --local --check ${SELECTED_CHECK_FILE} --access authenticated --json`;
    const afterThat = `Deploy ${SELECTED_CHECK_FILE} with ${RECIPE_FILE} in that directory. Then follow "Connect the deployed URL to Millwork" in README.md and choose the commands for your endpoint's access mode.`;
    if (interactive) {
        process.stdout.write(`Wrote the maintained output-check adapter to ${terminalText(relativeDirectory)}.\n`
            + `Selected recipe: ${selectedRecipe} (${selectedCheck}).\n`
            + `Files: ${written.join(", ")}.\n`
            + `Local contract test: ${nextCommand}\n`
            + `${afterThat}\n`
            + "This command does not deploy or connect.\n");
    }
    else {
        emitJson({
            operation: "verifier_init",
            directory: relativeDirectory,
            written,
            selected_recipe: selectedRecipe,
            selected_check: `${relativeDirectory}/${selectedCheck}`,
            deployed_check: `${relativeDirectory}/${SELECTED_CHECK_FILE}`,
            recipe: `${relativeDirectory}/${RECIPE_FILE}`,
            next_action: nextCommand,
            after_that: afterThat,
        });
    }
    return 0;
}
async function loadModule(absolutePath, label) {
    try {
        return await import(pathToFileURL(absolutePath).href);
    }
    catch {
        throw new InspectionUsageError(`Could not load ${label} ${absolutePath}.`);
    }
}
async function resolveKitModule(checkPath, cwd) {
    const checkDirectory = dirname(checkPath);
    try {
        await access(join(checkDirectory, "compatibility-kit.mjs"), fsConstants.R_OK);
        return {
            kit: await loadModule(join(checkDirectory, "compatibility-kit.mjs"), "compatibility kit"),
            kitRoot: checkDirectory,
        };
    }
    catch (error) {
        if (error instanceof InspectionUsageError)
            throw error;
    }
    const kitRoot = await findMaintainedKitRoot([checkDirectory, cwd, dirname(fileURLToPath(import.meta.url))]);
    return {
        kit: await loadModule(join(kitRoot, "compatibility-kit.mjs"), "compatibility kit"),
        kitRoot,
    };
}
async function runVerifierLocalTest(args, cwd, interactive) {
    for (const argument of args) {
        if (CREDENTIAL_ARGUMENT.test(argument)) {
            throw new InspectionUsageError("Keys are not accepted as arguments. Local contract tests generate their own keys and never need a Millwork account key.");
        }
    }
    if (flagValue(args, "--verifier-id") || flagValue(args, "--endpoint") || flagValue(args, "--auth-ref")) {
        throw new InspectionUsageError("verifier test --local never contacts Millwork. Drop --verifier-id, --endpoint and --auth-ref.");
    }
    if (hasFlag(args, "--deployed") || hasFlag(args, "--authorize-endpoint-test")) {
        throw new InspectionUsageError(`Deployed runs stay on ${RECIPE_FILE} and check-endpoint.mjs. verifier test --local only exercises the in-process adapter.`);
    }
    const check = flagValue(args, "--check");
    const access = flagValue(args, "--access");
    if (!check || check.startsWith("--") || !access) {
        const nextAction = "pass --check <module> and --access public|authenticated; local tests do not invent those values";
        if (interactive)
            process.stdout.write(`Local contract: not_usable.\nNext: ${nextAction}\n`);
        else {
            emitJson({
                operation: "verifier_test_local",
                state: "action_required",
                headline: "not_usable",
                next_action: nextAction,
            });
        }
        return 2;
    }
    if (access !== "public" && access !== "authenticated") {
        throw new InspectionUsageError("--access must be public or authenticated");
    }
    const checkRefusal = "--check must be a path inside the current workspace, reached without a symbolic link. Point it at the file where it really lives, for example: --check kit/listing-example-check.mjs";
    if (check.includes("\0") || isAbsolute(check) || check.split(/[/\\]/).includes("..")) {
        throw new InspectionUsageError(checkRefusal);
    }
    const checkPath = await assertInsideWorkspace(cwd, check, checkRefusal);
    const checkModule = await loadModule(checkPath, "check module");
    if (typeof checkModule.runHardCheck !== "function" || typeof checkModule.scoreQuality !== "function") {
        throw new InspectionUsageError("The check module must export runHardCheck and scoreQuality. Local tests do not invent a check.");
    }
    const { kit, kitRoot } = await resolveKitModule(checkPath, cwd);
    // relative() from the workspace, so the path is the one the customer can
    // actually open; a kit outside the workspace keeps its absolute path.
    const recipePath = kitRoot.startsWith(`${resolve(cwd)}${sep}`) || kitRoot === resolve(cwd)
        ? join(relative(cwd, kitRoot), RECIPE_FILE)
        : join(kitRoot, RECIPE_FILE);
    let report;
    try {
        report = await kit.runCompatibilityKit({
            target: { kind: "local", runHardCheck: checkModule.runHardCheck, scoreQuality: checkModule.scoreQuality },
            access: { mode: access },
            labelledCases: checkModule.labelledCases,
        });
    }
    catch (error) {
        if (error instanceof kit.KitUsageError || (error instanceof Error && error.name === "KitUsageError")) {
            throw new InspectionUsageError(error instanceof Error ? error.message : String(error));
        }
        throw error;
    }
    const passed = report.passed === true;
    const headline = passed ? "usable" : "not_usable";
    const deployThenConnect = `Deploy with ${recipePath}. Then follow "Connect the deployed URL to Millwork" in the README beside that recipe and choose the commands for your endpoint's access mode`;
    if (interactive) {
        process.stdout.write(`${kit.formatKitReport(report)}\nLocal contract: ${headline}. This is not a Millwork connection.\n`);
        if (passed)
            process.stdout.write(`${deployThenConnect}.\n`);
    }
    else {
        emitJson({
            operation: "verifier_test_local",
            headline,
            passed,
            report,
            recipe: recipePath,
            next_action: passed ? deployThenConnect : "Fix the failing local contract cases before connecting",
        });
    }
    return passed ? 0 : 1;
}
export async function runVerifierKit(args, cwd = process.cwd(), interactive = false) {
    if (args[0] !== "verifier")
        throw new InspectionUsageError("verifier kit commands start with verifier");
    if (args[1] === "init")
        return runVerifierInit(args, cwd, interactive);
    if (args[1] === "test" && hasFlag(args, "--local"))
        return runVerifierLocalTest(args, cwd, interactive);
    throw new InspectionUsageError("verifier kit commands are verifier init and verifier test --local");
}
