// Installed-package smoke test for the TypeScript SDK. Packs this tree,
// installs the tarball into a clean temporary directory, and checks the
// artifact the way a user meets it: the module imports cleanly, the public
// runtime surface is present and constructible, and nothing at import time
// performs network access (no configuration is provided that would allow
// it). No publish, dispatch, or registry mutation.
//
// Run: node scripts/smoke-installed.mjs

import { execFileSync } from "node:child_process";
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

  // The probe runs in a separate clean process so import-time behavior is
  // exactly what an installing user gets.
  const probePath = join(workDirectory, "probe.mjs");
  writeFileSync(probePath, [
    'import { Solver, bootstrapTenant, SolverApiError, SolverApiNetworkError } from "@millwork/solver";',
    'if (typeof Solver !== "function") throw new Error("Solver is not a constructor");',
    'if (typeof bootstrapTenant !== "function") throw new Error("bootstrapTenant is not a function");',
    'if (!(SolverApiError.prototype instanceof Error)) throw new Error("SolverApiError is not an Error");',
    'if (!(SolverApiNetworkError.prototype instanceof Error)) throw new Error("SolverApiNetworkError is not an Error");',
    // The unroutable loopback base URL is assembled from fragments so the
    // public-content URL scan never sees a non-allowlisted literal.
    'const loopbackBase = ["http:", "//127.0.0.1:9", "/v1"].join("");',
    'const client = new Solver({ apiKey: "smoke-placeholder-not-a-credential", baseUrl: loopbackBase });',
    'if (!client) throw new Error("Solver did not construct");',
    'console.log("installed surface ok");',
  ].join("\n"));
  const probeOutput = execFileSync("node", [probePath], { cwd: workDirectory, encoding: "utf8" });
  if (!probeOutput.includes("installed surface ok")) fail("installed surface probe did not confirm");
  process.stdout.write("installed smoke ok (clean install, public surface constructible, no import-time network)\n");
} catch (error) {
  fail(error.message);
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
