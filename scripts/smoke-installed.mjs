// Exercise the packed artifact exactly as a user receives it: clean install,
// module import, and the installed millwork binary's exact artifact identity.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidateVersion = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")).version;
const workDirectory = mkdtempSync(join(tmpdir(), "solver-sdk-smoke-"));

// A customer's machine is not this machine. Every child process below runs with
// its own HOME and npm cache and with nothing of the caller's account in the
// environment, so a passing run cannot be borrowing an npm login, a user-level
// .npmrc, an API key or a configured base URL. The user workspace deliberately
// contains spaces: a path that needs quoting is ordinary, and the kit's own
// guidance has to survive one.
const isolatedHome = join(workDirectory, "home");
const userWorkspace = join(workDirectory, "unrelated user workspace");
mkdirSync(isolatedHome);
mkdirSync(userWorkspace);
const cleanEnvironment = {
  PATH: process.env.PATH ?? "",
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  npm_config_cache: join(workDirectory, ".npm-cache"),
  npm_config_userconfig: join(isolatedHome, ".npmrc"),
  npm_config_update_notifier: "false",
};

function fail(message) {
  process.stderr.write(`FAIL ${message}\n`);
  rmSync(workDirectory, { recursive: true, force: true });
  process.exit(1);
}

try {
  const packOutput = JSON.parse(execFileSync(
    "npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", workDirectory],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ));
  const tarballPath = join(workDirectory, packOutput[0].filename);
  execFileSync("npm", ["init", "--yes"], { cwd: workDirectory, stdio: "ignore", env: cleanEnvironment });
  execFileSync("npm", ["install", "--ignore-scripts", tarballPath], { cwd: workDirectory, stdio: "ignore", env: cleanEnvironment });

  const probePath = join(workDirectory, "probe.mjs");
  writeFileSync(probePath, [
    'import { Solver, bootstrapTenant, SolverApiError, SolverApiNetworkError } from "@millwork/solver";',
    'if (typeof Solver !== "function") throw new Error("Solver is not a constructor");',
    'if (typeof bootstrapTenant !== "function") throw new Error("bootstrapTenant is not a function");',
    'if (!(SolverApiError.prototype instanceof Error)) throw new Error("SolverApiError is not an Error");',
    'if (!(SolverApiNetworkError.prototype instanceof Error)) throw new Error("SolverApiNetworkError is not an Error");',
    'console.log("installed surface ok");',
  ].join("\n"));
  const probe = execFileSync("node", [probePath], { cwd: workDirectory, encoding: "utf8", env: cleanEnvironment });
  if (!probe.includes("installed surface ok")) fail("module surface probe did not confirm");

  const binaryPath = join(workDirectory, "node_modules", ".bin", "millwork");
  // Installation may fetch the reviewed runtime dependency. Every provider
  // proof process has no credentials or API origin and actively denies network
  // I/O. Count attempted requests too: a swallowed network error is not offline.
  const networkLog = join(workDirectory, "network-attempts.log");
  const denyNetwork = join(workDirectory, "deny-network.cjs");
  writeFileSync(denyNetwork, `
const fs = require("node:fs");
const deny = () => {
  fs.appendFileSync(${JSON.stringify(networkLog)}, "attempt\\n");
  throw new Error("Network is denied for installed artifact verification");
};
globalThis.fetch = deny;
for (const name of ["node:http", "node:https"]) {
  const transport = require(name); transport.request = deny; transport.get = deny;
}
require("node:net").Socket.prototype.connect = deny;
require("node:dgram").Socket.prototype.send = deny;
require("node:dns").lookup = deny;
require("node:module").syncBuiltinESMExports();
`);
  const providerEnvironment = { ...cleanEnvironment, NODE_OPTIONS: `--require=${JSON.stringify(denyNetwork)}` };
  const networkControl = spawnSync("node", ["-e", "fetch('https://app.example').catch(() => {})"], {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (networkControl.status === 0 || !existsSync(networkLog)) fail("network-denial control did not refuse a request");
  rmSync(networkLog);

  const offerHelp = spawnSync(binaryPath, ["offer", "--help"], {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (offerHelp.status !== 0 || offerHelp.stderr !== ""
    || !offerHelp.stdout.includes("millwork offer check --profile")
    || !offerHelp.stdout.includes("millwork offer workspace")) {
    fail(`installed provider help failed: ${offerHelp.stdout}${offerHelp.stderr}`);
  }
  const supplierHelp = spawnSync(binaryPath, ["supplier", "--help"], {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (supplierHelp.status !== 0 || supplierHelp.stderr !== ""
    || !supplierHelp.stdout.includes("millwork supplier schema")
    || !supplierHelp.stdout.includes("millwork supplier init --directory")) {
    fail(`installed supplier help failed: ${supplierHelp.stdout}${supplierHelp.stderr}`);
  }
  const supplierSchema = spawnSync(binaryPath, ["supplier", "schema"], {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (supplierSchema.status !== 0 || supplierSchema.stderr !== "") {
    fail(`installed supplier schema failed: ${supplierSchema.stdout}${supplierSchema.stderr}`);
  }
  const schemas = JSON.parse(supplierSchema.stdout);
  if (Object.keys(schemas).sort().join(",") !== "feed,incumbent_feed,profile,validation_context"
    || Object.values(schemas).some(schema => !schema || typeof schema !== "object" || !schema.properties)) {
    fail("installed supplier schema did not expose the supported offline contracts");
  }
  const onlineRefusal = spawnSync(binaryPath, ["offer", "workspace"], {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (onlineRefusal.status !== 2 || !onlineRefusal.stderr.includes("Online offer commands require")
    || /ERR_[A-Z_]+|Cannot find/.test(onlineRefusal.stderr)) {
    fail(`installed online offer did not refuse missing credentials: ${onlineRefusal.stdout}${onlineRefusal.stderr}`);
  }
  const sample = spawnSync(binaryPath, ["supplier", "init", "--directory", "provider sample"], {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (sample.status !== 0 || sample.stderr !== "" || JSON.parse(sample.stdout).fixture_only !== true) {
    fail(`installed provider sample failed: ${sample.stdout}${sample.stderr}`);
  }
  const sampleDirectory = join(userWorkspace, "provider sample");
  const checkArguments = ["offer", "check", "--profile", join(sampleDirectory, "profile.json"),
    "--feed", join(sampleDirectory, "feed.json"), "--context", join(sampleDirectory, "context.json"), "--json"];
  const checked = spawnSync(binaryPath, checkArguments, {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (checked.status !== 0 || checked.stderr !== "" || JSON.parse(checked.stdout).result !== "validated") {
    fail(`installed offline provider check failed: ${checked.stdout}${checked.stderr}`);
  }
  const providerProbe = join(workDirectory, "provider-probe.mjs");
  writeFileSync(providerProbe, [
    'import { readFileSync } from "node:fs";',
    'import { ProviderClient, checkProviderFeed } from "@millwork/solver/provider";',
    'if (typeof ProviderClient !== "function") throw new Error("ProviderClient is missing");',
    `const sample = ${JSON.stringify(sampleDirectory)};`,
    'const read = name => JSON.parse(readFileSync(`${sample}/${name}.json`, "utf8"));',
    'const report = checkProviderFeed(read("feed"), { ...read("context"), profile: read("profile") });',
    'if (report.result !== "validated") throw new Error(JSON.stringify(report));',
    'console.log("installed provider SDK offline ok");',
  ].join("\n"));
  const providerImport = spawnSync("node", [providerProbe], {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (providerImport.status !== 0 || !providerImport.stdout.includes("installed provider SDK offline ok")) {
    fail(`installed provider subpath failed: ${providerImport.stdout}${providerImport.stderr}`);
  }
  // A failed check has a failing exit status and cannot look like a usable feed.
  const invalidFeed = JSON.parse(readFileSync(join(sampleDirectory, "feed.json"), "utf8"));
  invalidFeed.routes[0].model_key = "not-issued/release";
  writeFileSync(join(sampleDirectory, "feed.json"), JSON.stringify(invalidFeed));
  const refused = spawnSync(binaryPath, checkArguments, {
    cwd: userWorkspace, encoding: "utf8", env: providerEnvironment,
  });
  if (refused.status !== 2 || JSON.parse(refused.stdout).result !== "nonconformant") {
    fail(`installed provider check accepted a nonconformant feed: ${refused.stdout}${refused.stderr}`);
  }
  if (existsSync(networkLog)) fail("installed provider commands attempted a network request");
  const version = spawnSync(binaryPath, ["--version", "--json"], {
    cwd: workDirectory,
    encoding: "utf8",
    env: cleanEnvironment,
  });
  if (version.status !== 0 || version.stderr !== "") fail(`installed binary failed: ${version.stderr}`);
  const versionRecord = JSON.parse(version.stdout);
  if (versionRecord.schema_version !== 2 || versionRecord.package_version !== candidateVersion
    || Object.hasOwn(versionRecord, "supported_public_version")
    || Object.hasOwn(versionRecord, "public_cli_available")) {
    fail(`installed binary identity is invalid: ${version.stdout}`);
  }

  const docs = spawnSync(binaryPath, ["docs", "--json"], {
    cwd: workDirectory,
    encoding: "utf8",
    env: cleanEnvironment,
  });
  if (docs.status !== 0 || docs.stderr !== "") fail(`installed docs command failed: ${docs.stderr}`);
  const docsRecord = JSON.parse(docs.stdout);
  if (!String(docsRecord.url).startsWith("https://docs.getmillwork.dev/")) {
    fail("installed docs command returned an unexpected URL");
  }
  if (versionRecord.support_information_url !== docsRecord.url) {
    fail("installed version and docs commands disagree on the support information URL");
  }

  // Discovery, from the same clean install. An agent that has just installed
  // this package runs --help first and must be able to get from there to the
  // whole verifier surface without a key, a network call or a checkout. Every
  // in-repository test of this passes with the repository one directory up,
  // which is exactly the condition that hid the kit's own failures.
  const help = spawnSync(binaryPath, ["--help"], { cwd: userWorkspace, encoding: "utf8", env: cleanEnvironment });
  if (help.status !== 0) fail(`installed --help exited ${help.status}: ${help.stderr}`);
  if (help.stderr !== "") fail("installed --help wrote to stderr; asking for help is not an error");
  if (!help.stdout.includes("millwork verifier capabilities")) {
    fail("installed --help does not route a reader to the verifier capability command");
  }

  const capabilities = spawnSync(binaryPath, ["verifier", "capabilities", "--json"], {
    cwd: userWorkspace,
    encoding: "utf8",
    env: cleanEnvironment,
  });
  if (capabilities.status !== 0 || capabilities.stderr !== "") {
    fail(`installed verifier capabilities failed: ${capabilities.stderr}`);
  }
  const capabilityRecord = JSON.parse(capabilities.stdout);
  if (capabilityRecord.discovery?.account_key_required !== false || capabilityRecord.discovery?.network_calls !== 0) {
    fail(`installed capability document does not describe itself as offline: ${capabilities.stdout}`);
  }
  if (capabilityRecord.package?.version !== versionRecord.package_version) {
    fail("installed capability document and --version disagree about the package version");
  }
  if (!String(capabilityRecord.dock_contract?.url).startsWith("https://docs.getmillwork.dev/")) {
    fail("installed capability document does not name the dock contract");
  }
  const reportedCommands = (capabilityRecord.commands ?? []).map((entry) => entry.command);
  if (reportedCommands.length === 0 || reportedCommands.some((command) => !command.startsWith("millwork verifier "))) {
    fail(`installed capability document reported commands outside the verifier surface: ${reportedCommands.join(", ")}`);
  }

  // An agent acts on what it just read. Every recipe the document publishes
  // has to be one this installed binary will actually write.
  const publishedRecipes = capabilityRecord.commands
    .find((entry) => entry.command === "millwork verifier init")?.enum_values?.["--recipe"] ?? [];
  if (publishedRecipes.length === 0) fail("installed capability document publishes no recipe choices");
  for (const recipe of publishedRecipes) {
    const attempt = spawnSync(binaryPath, ["verifier", "init", `published-${recipe}`, "--recipe", recipe, "--json"], {
      cwd: userWorkspace,
      encoding: "utf8",
      env: cleanEnvironment,
    });
    if (attempt.status !== 0) {
      fail(`installed capability document publishes --recipe ${recipe}, which the installed binary refused`);
    }
    if (JSON.parse(attempt.stdout).selected_recipe !== recipe) {
      fail(`installed binary selected a different recipe than the published ${recipe}`);
    }
  }

  // The output-check kit is only real if it works from the installed package,
  // in a directory with no checkout above it. This is where the kit's own
  // failures hid: every in-repository test passed while this exited 2.
  const kitDirectory = "kit space";
  const kitRecipe = `${kitDirectory}/DEPLOYMENT_RECIPE.md`;
  const kitRun = spawnSync(binaryPath, ["verifier", "init", kitDirectory, "--json"], {
    cwd: userWorkspace,
    encoding: "utf8",
    env: cleanEnvironment,
  });
  if (kitRun.status !== 0) fail(`installed kit init failed: ${kitRun.stdout}${kitRun.stderr}`);
  const kitRecord = JSON.parse(kitRun.stdout);
  const expectedKitFiles = [
    "handler.mjs", "compatibility-kit.mjs", "check-endpoint.mjs",
    "listing-example-check.mjs", "minimal-output-check.mjs",
    "recipe-a-structured-output.mjs", "recipe-b-semantic-judgment.mjs",
    "recipe-c-evaluator-adapter.mjs", "recipe-d-completion-evidence.mjs",
    "selected-check.mjs",
    "existing-node-app.mjs", "minimal-node-dock.mjs", "minimal-python-dock.py",
    "README.md", "DEPLOYMENT_RECIPE.md",
  ];
  if (JSON.stringify(kitRecord.written) !== JSON.stringify(expectedKitFiles)) {
    fail(`installed kit wrote an unexpected file set: ${JSON.stringify(kitRecord.written)}`);
  }
  if (kitRecord.recipe !== kitRecipe) {
    fail(`installed kit named a recipe the caller cannot open: ${kitRecord.recipe}`);
  }
  for (const file of expectedKitFiles) {
    const written = readFileSync(join(userWorkspace, kitDirectory, file), "utf8");
    if (written.length === 0) fail(`installed kit wrote an empty file: ${file}`);
    const leak = written.match(/\b(?:DH|PY|CT|RS|TL|SH)[0-9](?:\.[0-9]+)?\b|\bJ[0-9]\.[0-9]\b|\/(?:Users|home|var\/folders)\//);
    if (leak) fail(`installed kit file ${file} carries internal content: ${leak[0]}`);
  }
  if (JSON.stringify(readdirSync(join(userWorkspace, kitDirectory)).sort())
    !== JSON.stringify([...expectedKitFiles].sort())) {
    fail("the installed kit did not write exactly the expected files into the workspace");
  }
  // Both local access modes, from a working directory whose name needs quoting.
  for (const mode of ["authenticated", "public"]) {
    const kitLocal = spawnSync(binaryPath, [
      "verifier", "test", "--local", "--check", `${kitDirectory}/listing-example-check.mjs`, "--access", mode, "--json",
    ], { cwd: userWorkspace, encoding: "utf8", env: cleanEnvironment });
    if (kitLocal.status !== 0) fail(`installed kit local ${mode} test failed: ${kitLocal.stdout}${kitLocal.stderr}`);
    const localRecord = JSON.parse(kitLocal.stdout);
    if (localRecord.passed !== true || localRecord.recipe !== kitRecipe) {
      fail(`installed kit local ${mode} run reported unusable guidance: ${kitLocal.stdout}`);
    }
  }

  // A clean installed CLI must preserve recipe selection into the deployed
  // selector; the default-kit smoke alone would miss a fallback to listing.
  const selectedRun = spawnSync(binaryPath, ["verifier", "init", "recipe-a", "--recipe", "a", "--json"], {
    cwd: userWorkspace,
    encoding: "utf8",
    env: cleanEnvironment,
  });
  if (selectedRun.status !== 0) fail(`installed recipe init failed: ${selectedRun.stdout}${selectedRun.stderr}`);
  const selectedRecord = JSON.parse(selectedRun.stdout);
  if (selectedRecord.selected_recipe !== "a" || selectedRecord.deployed_check !== join("recipe-a", "selected-check.mjs")) {
    fail(`installed recipe selection drifted: ${selectedRun.stdout}`);
  }
  const selector = readFileSync(join(userWorkspace, selectedRecord.deployed_check), "utf8");
  const selectedModule = "recipe-a-structured-output.mjs";
  if (!selector.includes(`from ${JSON.stringify(`./${selectedModule}`)}`)) {
    fail("installed deployment selector did not point at recipe A");
  }
  const selectedLocal = spawnSync(binaryPath, [
    "verifier", "test", "--local", "--check", selectedRecord.deployed_check, "--access", "public", "--json",
  ], { cwd: userWorkspace, encoding: "utf8", env: cleanEnvironment });
  if (selectedLocal.status !== 0 || JSON.parse(selectedLocal.stdout).passed !== true) {
    fail(`installed selected recipe did not pass locally: ${selectedLocal.stdout}${selectedLocal.stderr}`);
  }

  if (existsSync(networkLog)) fail("installed offline commands attempted a network request");
  process.stdout.write(
    "installed provider smoke ok (provider subpath, supplier help and schema, offer help and credential refusal, valid and invalid feed, no key or API origin, network denied, zero requests)\n"
    + "installed smoke ok (module import, millwork binary, exact version, docs, offline help and verifier "
    + "capabilities with every published recipe written, selected output-check kit in an isolated home "
    + "from a spaced workspace, public and authenticated)\n",
  );
} catch (error) {
  fail(error.message);
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
