#!/usr/bin/env node
/**
 * Runs the output-check compatibility kit from a terminal.
 *
 *   node check-endpoint.mjs --local --check listing-example-check.mjs --access authenticated
 *   node check-endpoint.mjs --deployed https://app.example/millwork-check \
 *     --authorize-endpoint-test --check listing-example-check.mjs --access authenticated
 *
 * Keys never come from arguments. For an authenticated deployed endpoint:
 *   MILLWORK_KIT_ENDPOINT_KEY  the key the endpoint accepts now (required)
 *   MILLWORK_KIT_OVERLAP_KEYS  other keys it must also accept now, comma-separated (optional)
 *   MILLWORK_KIT_RETIRED_KEYS  keys it must now reject, comma-separated (optional)
 *
 * Exit status: 0 every case passed, 1 a case failed, 2 the run was refused
 * before testing (usage, authorization or configuration).
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAcceptedKeys } from "./handler.mjs";
import { KitUsageError, formatKitReport, runCompatibilityKit } from "./compatibility-kit.mjs";

const USAGE = `Usage:
  node check-endpoint.mjs --local --check <module> --access <public|authenticated> [--json]
  node check-endpoint.mjs --deployed <https-url> --authorize-endpoint-test --check <module> --access <public|authenticated> [--json]

<module> exports labelledCases, and for --local also runHardCheck and scoreQuality.
Keys for an authenticated deployed endpoint come from MILLWORK_KIT_ENDPOINT_KEY,
MILLWORK_KIT_OVERLAP_KEYS and MILLWORK_KIT_RETIRED_KEYS, never from arguments.`;

const CREDENTIAL_ARGUMENT = /^--(key|token|secret|password|bearer|api-key|credential)/i;

function parseArguments(argumentList) {
  const parsed = { json: false, authorizeEndpointTest: false };
  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    const next = () => {
      const value = argumentList[index + 1];
      if (value === undefined || value.startsWith("--")) throw new KitUsageError(`${argument} needs a value.`);
      index += 1;
      return value;
    };
    if (CREDENTIAL_ARGUMENT.test(argument)) {
      throw new KitUsageError(
        "Keys are not accepted as arguments, where shell history and process lists can keep them. " +
          "Set MILLWORK_KIT_ENDPOINT_KEY in the environment instead.",
      );
    }
    if (argument === "--local") parsed.local = true;
    else if (argument === "--deployed") parsed.deployed = next();
    else if (argument === "--check") parsed.check = next();
    else if (argument === "--access") parsed.access = next();
    else if (argument === "--authorize-endpoint-test") parsed.authorizeEndpointTest = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new KitUsageError(`Unknown argument ${argument}.`);
  }
  return parsed;
}

async function loadCheckModule(path) {
  try {
    return await import(pathToFileURL(resolve(process.cwd(), path)).href);
  } catch {
    throw new KitUsageError(`Could not load the check module ${path}.`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (Boolean(options.local) === Boolean(options.deployed)) {
    throw new KitUsageError("Choose exactly one target: --local or --deployed <https-url>.");
  }
  if (options.access !== "public" && options.access !== "authenticated") {
    throw new KitUsageError("Choose the endpoint's access mode explicitly: --access public or --access authenticated.");
  }
  if (options.check === undefined) throw new KitUsageError("Name your check module with --check <module>.");
  if (options.deployed !== undefined && !options.authorizeEndpointTest) {
    throw new KitUsageError(
      "Testing a deployed endpoint sends labelled test requests to it, including intentional failures. " +
        "Add --authorize-endpoint-test to allow that.",
    );
  }

  const checkModule = await loadCheckModule(options.check);
  const access = { mode: options.access };
  if (options.deployed !== undefined && options.access === "authenticated") {
    const key = process.env.MILLWORK_KIT_ENDPOINT_KEY;
    if (typeof key !== "string" || key.trim() === "") {
      throw new KitUsageError("Set MILLWORK_KIT_ENDPOINT_KEY to the key the endpoint accepts now, then rerun.");
    }
    access.key = key.trim();
    access.overlapKeys = parseAcceptedKeys(process.env.MILLWORK_KIT_OVERLAP_KEYS);
    access.retiredKeys = parseAcceptedKeys(process.env.MILLWORK_KIT_RETIRED_KEYS);
  }

  const target =
    options.local
      ? { kind: "local", runHardCheck: checkModule.runHardCheck, scoreQuality: checkModule.scoreQuality }
      : { kind: "deployed", url: options.deployed, authorizedEndpointTest: true };

  const report = await runCompatibilityKit({ target, access, labelledCases: checkModule.labelledCases });
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatKitReport(report)}\n`);
  return report.passed ? 0 : 1;
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error) => {
    // Usage problems print their own message; anything else prints only its
    // name, since an unexpected error's text could quote a response.
    process.stderr.write(error instanceof KitUsageError ? `${error.message}\n\n${USAGE}\n` : `Kit stopped: ${error?.name ?? "Error"}\n`);
    process.exitCode = 2;
  },
);
