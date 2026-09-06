// Exercise the packed artifact exactly as a user receives it: clean install,
// module import, and the installed millwork binary's exact artifact identity.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workDirectory = mkdtempSync(join(tmpdir(), "solver-sdk-smoke-"));

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
  execFileSync("npm", ["init", "--yes"], { cwd: workDirectory, stdio: "ignore" });
  execFileSync("npm", ["install", "--ignore-scripts", tarballPath], { cwd: workDirectory, stdio: "ignore" });

  const probePath = join(workDirectory, "probe.mjs");
  writeFileSync(probePath, [
    'import { Solver, bootstrapTenant, SolverApiError, SolverApiNetworkError } from "@millwork/solver";',
    'if (typeof Solver !== "function") throw new Error("Solver is not a constructor");',
    'if (typeof bootstrapTenant !== "function") throw new Error("bootstrapTenant is not a function");',
    'if (!(SolverApiError.prototype instanceof Error)) throw new Error("SolverApiError is not an Error");',
    'if (!(SolverApiNetworkError.prototype instanceof Error)) throw new Error("SolverApiNetworkError is not an Error");',
    'console.log("installed surface ok");',
  ].join("\n"));
  const probe = execFileSync("node", [probePath], { cwd: workDirectory, encoding: "utf8" });
  if (!probe.includes("installed surface ok")) fail("module surface probe did not confirm");

  const binaryPath = join(workDirectory, "node_modules", ".bin", "millwork");
  const version = spawnSync(binaryPath, ["--version", "--json"], {
    cwd: workDirectory,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  if (version.status !== 0 || version.stderr !== "") fail(`installed binary failed: ${version.stderr}`);
  const versionRecord = JSON.parse(version.stdout);
  if (versionRecord.schema_version !== 2 || versionRecord.package_version !== "0.1.3"
    || Object.hasOwn(versionRecord, "supported_public_version")
    || Object.hasOwn(versionRecord, "public_cli_available")) {
    fail(`installed binary identity is invalid: ${version.stdout}`);
  }

  const docs = spawnSync(binaryPath, ["docs", "--json"], {
    cwd: workDirectory,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  if (docs.status !== 0 || docs.stderr !== "") fail(`installed docs command failed: ${docs.stderr}`);
  const docsRecord = JSON.parse(docs.stdout);
  if (!String(docsRecord.url).startsWith("https://docs.getmillwork.dev/")) {
    fail("installed docs command returned an unexpected URL");
  }
  if (versionRecord.support_information_url !== docsRecord.url) {
    fail("installed version and docs commands disagree on the support information URL");
  }

  process.stdout.write("installed smoke ok (module import, millwork binary, exact version, docs)\n");
} catch (error) {
  fail(error.message);
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
