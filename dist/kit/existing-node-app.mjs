#!/usr/bin/env node
/**
 * Maintained existing-app placement for the output-check adapter.
 *
 * The exported listener composes one authenticated `/millwork-check` route
 * into a Node HTTP app without taking over its other routes. Running this file
 * directly is the smallest deployable example of that same composition.
 */

import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ADAPTER_NAME,
  ADAPTER_VERSION,
  authenticatedAccess,
  createOutputCheckRequestListener,
  keysFromEnvironment,
} from "./handler.mjs";
import {
  runHardCheck as exampleHardCheck,
  scoreQuality as exampleQualityScore,
} from "./listing-example-check.mjs";

export const OUTPUT_CHECK_PATH = "/millwork-check";
export const HEALTH_PATH = "/healthz";

function pathname(request) {
  try {
    return new URL(request.url ?? "/", "http://existing-app.invalid").pathname;
  } catch {
    return null;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

/**
 * Adds the maintained adapter route to an existing Node HTTP application.
 * `otherwise` keeps ownership of every unrelated path with the host app.
 *
 * The health route answers here, not only in the directly runnable example:
 * the deployment recipe asks you to confirm the adapter and Node versions at
 * `GET /healthz` after deploying, and that check has to work for the app you
 * actually composed. It reports versions only -- never a key, and nothing
 * about any request. Pass `healthPath: null` when your application already
 * serves that path, or another absolute path to move it.
 */
export function createExistingNodeAppListener({
  environment = process.env,
  access,
  outputCheckPath = OUTPUT_CHECK_PATH,
  healthPath = HEALTH_PATH,
  runHardCheck = exampleHardCheck,
  scoreQuality = exampleQualityScore,
  otherwise = (_request, response) => sendJson(response, 404, { error: "not_found" }),
} = {}) {
  if (typeof outputCheckPath !== "string" || !outputCheckPath.startsWith("/") || outputCheckPath.includes("?")) {
    throw new TypeError("outputCheckPath must be an absolute URL path without a query string");
  }
  if (healthPath !== null && (typeof healthPath !== "string" || !healthPath.startsWith("/") || healthPath.includes("?"))) {
    throw new TypeError("healthPath must be null or an absolute URL path without a query string");
  }
  if (healthPath === outputCheckPath) {
    throw new TypeError("healthPath and outputCheckPath must differ");
  }
  if (typeof otherwise !== "function") throw new TypeError("otherwise must be a request listener");

  const outputCheck = createOutputCheckRequestListener({
    // Authenticated unless the caller chose otherwise: an endpoint is never
    // public by omission. Pass publicAccess() to make that choice explicit.
    access: access ?? authenticatedAccess({ acceptedKeys: keysFromEnvironment("MILLWORK_VERIFIER_KEYS", environment) }),
    runHardCheck,
    scoreQuality,
  });

  return async (request, response) => {
    const requestPath = pathname(request);
    if (requestPath === outputCheckPath) {
      await outputCheck(request, response);
      return;
    }
    if (healthPath !== null && requestPath === healthPath && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        adapter: ADAPTER_NAME,
        adapter_version: ADAPTER_VERSION,
        runtime: `node ${process.versions.node}`,
      });
      return;
    }
    await otherwise(request, response);
  };
}

/** The directly runnable example is the same listener with nothing else mounted. */
export function createRunnableExampleListener(options = {}) {
  return createExistingNodeAppListener(options);
}

export function portFromEnvironment(environment = process.env) {
  const raw = environment.PORT ?? "8080";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("PORT must be an integer from 1 to 65535");
  }
  return port;
}

export function startRunnableExample({ environment = process.env, hostname = "0.0.0.0" } = {}) {
  const port = portFromEnvironment(environment);
  const server = createServer(createRunnableExampleListener({ environment }));
  server.listen(port, hostname, () => {
    // Do not print the configured keys or any request data.
    process.stdout.write(
      `${ADAPTER_NAME} ${ADAPTER_VERSION} on node ${process.versions.node}; `
      + `listening on ${hostname}:${port}${OUTPUT_CHECK_PATH}\n`,
    );
  });
  return server;
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) startRunnableExample();
