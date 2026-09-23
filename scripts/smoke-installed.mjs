// Exercise the packed artifact exactly as a user receives it: clean install,
// module import, and the installed millwork binary's exact artifact identity.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  const version = spawnSync(binaryPath, ["--version", "--json"], {
    cwd: workDirectory,
    encoding: "utf8",
    env: cleanEnvironment,
  });
  if (version.status !== 0 || version.stderr !== "") fail(`installed binary failed: ${version.stderr}`);
  const versionRecord = JSON.parse(version.stdout);
  if (versionRecord.schema_version !== 2 || versionRecord.package_version !== "0.1.17"
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

  process.stdout.write(
    "installed smoke ok (module import, millwork binary, exact version, docs, selected output-check kit "
    + "in an isolated home from a spaced workspace, public and authenticated)\n",
  );
} catch (error) {
  fail(error.message);
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
