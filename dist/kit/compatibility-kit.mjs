/**
 * Executable compatibility kit for the output-check adapter.
 *
 * Runs one versioned set of cases against either the adapter running
 * locally in this process or a deployed HTTPS endpoint, through the same
 * request/response contract Millwork uses. It checks the contract, access
 * and timing. It does not certify that your checking logic is correct, and
 * passing it is not evidence that a customer can complete the journey.
 *
 * Credentials are inputs only. They are never printed, never placed in the
 * report, and the report is checked for them before it is returned.
 */

import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  ADAPTER_NAME,
  ADAPTER_VERSION,
  RESERVED_PROBE,
  authenticatedAccess,
  createOutputCheckRequestListener,
  publicAccess,
} from "./handler.mjs";

export const KIT_NAME = "millwork-output-check-kit";
export const KIT_VERSION = "1.0.0";

/** Millwork's own bounds: the registration probe waits 3 s, an evaluation 10 s. */
export const MILLWORK_BOUNDS = Object.freeze({ probeMs: 3_000, evaluationMs: 10_000 });

export const SCOPE_NOTE =
  "Checks the request/result contract, endpoint access and timing. It does not certify that your check is correct.";

export class KitUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "KitUsageError";
  }
}

/** Contacting a deployed endpoint sends labelled test traffic, including
 *  intentional failures, so it only happens when explicitly authorized. */
export class KitAuthorizationRequiredError extends KitUsageError {
  constructor() {
    super("Testing a deployed endpoint sends labelled test requests to it. Authorize that explicitly, then rerun.");
    this.name = "KitAuthorizationRequiredError";
  }
}

export class KitCredentialLeakError extends Error {
  constructor() {
    super("The kit refused to return a report that contains a credential.");
    this.name = "KitCredentialLeakError";
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** Millwork refuses a verifier response larger than this (safeDispatch.ts). */
export const MAX_RESPONSE_BYTES = 1_048_576;

/**
 * One request under an absolute deadline from send to the last response
 * byte. Node's socket `timeout` only measures inactivity, so a peer that
 * keeps dripping bytes would never trip it; this timer does, and it destroys
 * both directions. Buffering is capped at Millwork's own response limit.
 */
function sendRequest(url, { method = "POST", headers = {}, body, chunks, timeoutMs }) {
  const target = new URL(url);
  const requestFunction = target.protocol === "https:" ? httpsRequest : httpRequest;
  const outgoingHeaders = { "content-type": "application/json", ...headers };
  if (chunks !== undefined) outgoingHeaders["transfer-encoding"] = "chunked";
  const started = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    let incomingResponse;
    let outgoing;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({ ...value, elapsed_ms: Math.round(performance.now() - started) });
    };
    const abandon = (transportError) => {
      finish({ transport_error: transportError });
      incomingResponse?.destroy();
      outgoing?.destroy();
    };
    const deadline = setTimeout(() => abandon("timeout"), timeoutMs);
    outgoing = requestFunction(target, { method, headers: outgoingHeaders }, (incoming) => {
      incomingResponse = incoming;
      const parts = [];
      let received = 0;
      incoming.on("data", (part) => {
        received += part.length;
        if (received > MAX_RESPONSE_BYTES) {
          abandon("response_too_large");
          return;
        }
        parts.push(part);
      });
      incoming.on("end", () => finish({ status: incoming.statusCode ?? 0, text: Buffer.concat(parts).toString("utf8") }));
      incoming.on("error", () => finish({ transport_error: "network" }));
    });
    outgoing.on("error", () => finish({ transport_error: "network" }));
    if (chunks !== undefined) {
      for (const chunk of chunks) outgoing.write(chunk);
      outgoing.end();
    } else {
      outgoing.end(body ?? "");
    }
  });
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isVerifierResult(body) {
  if (body === null) return false;
  if (typeof body.is_correct !== "boolean") return false;
  if (typeof body.quality_score !== "number" || !Number.isFinite(body.quality_score)) return false;
  if (body.quality_score < 0 || body.quality_score > 1) return false;
  if (body.anchor_results !== undefined) {
    const anchors = body.anchor_results;
    if (anchors === null || typeof anchors !== "object" || Array.isArray(anchors)) return false;
    if (!Object.values(anchors).every((value) => typeof value === "boolean")) return false;
  }
  if (body.named_metrics !== undefined) {
    const metrics = body.named_metrics;
    if (metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) return false;
    if (!Object.values(metrics).every((value) => typeof value === "number" && !Number.isNaN(value))) return false;
  }
  return true;
}

function sortedEntries(record) {
  return record === undefined
    ? null
    : Object.fromEntries(Object.entries(record).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
}

/** The whole VerifierResult in a form where key order does not matter. */
function canonicalVerdict(verdict) {
  if (verdict === undefined) return null;
  return JSON.stringify({
    is_correct: verdict.is_correct,
    quality_score: verdict.quality_score,
    anchor_results: sortedEntries(verdict.anchor_results),
    named_metrics: sortedEntries(verdict.named_metrics),
  });
}

const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Only the fields a reader needs. Response bodies are never copied whole. */
function observe(reply) {
  if (reply.transport_error !== undefined) {
    return { transport_error: reply.transport_error, elapsed_ms: reply.elapsed_ms };
  }
  const body = parseJsonObject(reply.text);
  const observed = { status: reply.status, elapsed_ms: reply.elapsed_ms };
  if (isVerifierResult(body)) {
    observed.verdict = {
      is_correct: body.is_correct,
      quality_score: body.quality_score,
      ...(body.anchor_results !== undefined ? { anchor_results: body.anchor_results } : {}),
      ...(body.named_metrics !== undefined ? { named_metrics: body.named_metrics } : {}),
    };
  } else if (body !== null && ("is_correct" in body || "quality_score" in body)) {
    observed.verdict_shaped = true;
  }
  // An endpoint's error text is only kept when it looks like an error code.
  // Free text from the endpoint can carry anything, including the key it was
  // sent; the credential guard is the backstop, not the only defence.
  if (body !== null && typeof body.error === "string") {
    if (ERROR_CODE_PATTERN.test(body.error)) observed.error = body.error;
    else observed.error_unrecognized = true;
  }
  return observed;
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

function refused(observed, status) {
  if (observed.status !== status) return `expected HTTP ${status}, got ${describeStatus(observed)}`;
  if (observed.verdict !== undefined || observed.verdict_shaped) return "a refused request must not carry a verdict";
  return null;
}

function failClosed(observed) {
  if (observed.status !== 200) return `expected HTTP 200, got ${describeStatus(observed)}`;
  if (observed.verdict === undefined) return "expected a VerifierResult body";
  if (observed.verdict.is_correct !== false || observed.verdict.quality_score !== 0) {
    return "expected is_correct false and quality_score 0";
  }
  return null;
}

function validResult(observed) {
  if (observed.status !== 200) return `expected HTTP 200, got ${describeStatus(observed)}`;
  if (observed.verdict === undefined) return "expected a VerifierResult body (is_correct, quality_score from 0 to 1)";
  return null;
}

function withinBound(observed, boundMs, what) {
  if (observed.transport_error === "timeout") return `no answer within ${boundMs} ms (${what})`;
  if (observed.elapsed_ms > boundMs) return `answered in ${observed.elapsed_ms} ms; Millwork waits ${boundMs} ms (${what})`;
  return null;
}

function describeStatus(observed) {
  return observed.transport_error !== undefined ? `no response (${observed.transport_error})` : `HTTP ${observed.status}`;
}

function matchesLabelledExpectation(observed, expectation) {
  if (expectation.technical_failure !== undefined) {
    return refused(observed, expectation.technical_failure.status);
  }
  const invalid = validResult(observed);
  if (invalid !== null) return invalid;
  const verdict = observed.verdict;
  if (verdict.is_correct !== expectation.is_correct) {
    return `expected is_correct ${expectation.is_correct}, got ${verdict.is_correct}`;
  }
  const range = expectation.quality_score;
  if (range?.min !== undefined && verdict.quality_score < range.min) {
    return `expected quality_score at least ${range.min}, got ${verdict.quality_score}`;
  }
  if (range?.max !== undefined && verdict.quality_score > range.max) {
    return `expected quality_score at most ${range.max}, got ${verdict.quality_score}`;
  }
  for (const [anchor, expected] of Object.entries(expectation.anchor_results ?? {})) {
    if (verdict.anchor_results?.[anchor] !== expected) {
      return `expected anchor ${anchor} to be ${expected}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Placement-specific cases the developer writes from their own check: each
 * names a candidate and either the verdict or technical failure the actual
 * check gives it. At least one must expect a pass and one a rejection, so
 * both verdict signals are exercised. A technical-failure case is optional
 * for existing checks and required by the Cookbook overlays.
 */
export function validateLabelledCases(labelledCases) {
  if (!Array.isArray(labelledCases) || labelledCases.length === 0) {
    throw new KitUsageError("Supply labelledCases: candidates from your own check with the verdict each should get.");
  }
  const identifiers = new Set();
  for (const labelled of labelledCases) {
    if (typeof labelled?.id !== "string" || !/^[a-z0-9][a-z0-9_.-]*$/i.test(labelled.id)) {
      throw new KitUsageError("Each labelled case needs an id of letters, digits, '.', '_' or '-'.");
    }
    if (identifiers.has(labelled.id)) throw new KitUsageError(`Labelled case id ${labelled.id} is used twice.`);
    identifiers.add(labelled.id);
    if (typeof labelled.label !== "string" || labelled.label.trim() === "") {
      throw new KitUsageError(`Labelled case ${labelled.id} needs a label saying what it demonstrates.`);
    }
    if (!Object.prototype.hasOwnProperty.call(labelled, "candidate")) {
      throw new KitUsageError(`Labelled case ${labelled.id} needs a candidate.`);
    }
    const verdict = typeof labelled.expect?.is_correct === "boolean";
    const technical = labelled.expect?.technical_failure;
    const technicalFailure = technical !== undefined
      && technical !== null
      && typeof technical === "object"
      && [500, 504].includes(technical.status);
    if (verdict === technicalFailure) {
      throw new KitUsageError(
        `Labelled case ${labelled.id} needs either expect.is_correct (true or false) or expect.technical_failure.status (500 or 504).`,
      );
    }
  }
  const expectations = labelledCases
    .filter((labelled) => typeof labelled.expect.is_correct === "boolean")
    .map((labelled) => labelled.expect.is_correct);
  if (!expectations.includes(true) || !expectations.includes(false)) {
    throw new KitUsageError(
      "Supply at least one labelled case your check passes and one it rejects, so both verdicts are exercised.",
    );
  }
}

function validateDeployedUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new KitUsageError("The deployed endpoint must be an absolute https URL.");
  }
  if (url.protocol !== "https:") {
    throw new KitUsageError("The deployed endpoint must use https. Millwork only calls https endpoints.");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "") {
    throw new KitUsageError("Remove credentials and query parameters from the URL. Keys travel only in the Authorization header.");
  }
  return url;
}

function keyList(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((key) => typeof key !== "string" || key === "")) {
    throw new KitUsageError(`${name} must be a list of non-empty keys.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const probeBody = JSON.stringify({ candidate: RESERVED_PROBE });

function bearer(key) {
  return { authorization: `Bearer ${key}` };
}

function isStructured(candidate) {
  return candidate !== null && typeof candidate === "object";
}

/**
 * The shared case list. `context.send(options)` posts to the endpoint under
 * test and resolves to an observation; `context.keys` holds what the kit may
 * present. Every case is labelled as a test input, and intentional failures
 * say so, so the endpoint's own logs can be read without guessing.
 */
async function runSharedCases(context) {
  const { send, access, bounds, labelledCases, record } = context;
  const probeTimeout = bounds.probeMs + 1_000;
  const evaluationTimeout = bounds.evaluationMs + 1_000;
  const validHeaders = access.mode === "authenticated" ? bearer(access.currentKey) : {};
  // Every case is held to the bound Millwork applies to its request shape.
  // The transport deadline adds a second of grace so a late answer is
  // observed and named; that grace never lets a late answer pass.
  const inProbeBound = (observed, failure) => failure ?? withinBound(observed, bounds.probeMs, "registration probe bound");
  const inEvaluationBound = (observed, failure) => failure ?? withinBound(observed, bounds.evaluationMs, "evaluation bound");

  if (access.mode === "authenticated") {
    const missing = await send({ body: probeBody, timeoutMs: probeTimeout });
    record("access.missing_key_before_probe", "Intentional failure: the reserved probe with no key is refused (401) before any probe answer.", true, inProbeBound(missing, refused(missing, 401)), missing);

    const wrong = await send({ body: probeBody, headers: bearer(access.wrongKey), timeoutMs: probeTimeout });
    record("access.wrong_key_before_probe", "Intentional failure: the reserved probe with a wrong key is refused (401).", true, inProbeBound(wrong, refused(wrong, 401)), wrong);
  } else {
    record("access.public", "Public access chosen: the endpoint accepts calls without a key.", false, null, null, "not_applicable");
  }

  const probe = await send({ body: probeBody, headers: validHeaders, timeoutMs: probeTimeout });
  record(
    "probe.reserved",
    "The reserved registration probe gets the fixed fail-closed verdict within Millwork's probe bound.",
    false,
    inProbeBound(probe, failClosed(probe)),
    probe,
  );

  const chunked = await send({
    chunks: [probeBody.slice(0, 5), probeBody.slice(5, 20), probeBody.slice(20)],
    headers: validHeaders,
    timeoutMs: probeTimeout,
  });
  record("request.chunked_post", "Test input: the probe sent as a chunked POST is read in full.", false, inProbeBound(chunked, failClosed(chunked)), chunked);

  const nestedMarker = await send({
    body: JSON.stringify({ candidate: { labelled_test_input: { solverapi_probe: "kit" } } }),
    headers: validHeaders,
    timeoutMs: probeTimeout,
  });
  record("probe.marker_in_structured_candidate", "Test input: a probe marker nested in structured output is fail-closed.", false, inProbeBound(nestedMarker, failClosed(nestedMarker)), nestedMarker);

  const markerInText = await send({
    body: JSON.stringify({ candidate: JSON.stringify({ labelled_test_input: [{ solverapi_probe: "kit" }] }) }),
    headers: validHeaders,
    timeoutMs: probeTimeout,
  });
  record("probe.marker_after_parsing", "Test input: a probe marker inside model text is fail-closed after parsing.", false, inProbeBound(markerInText, failClosed(markerInText)), markerInText);

  const malformed = await send({ body: "{labelled test input: not json", headers: validHeaders, timeoutMs: probeTimeout });
  record("request.malformed_json", "Intentional failure: a body that is not JSON is refused (400) with no verdict.", true, inProbeBound(malformed, refused(malformed, 400)), malformed);

  const noCandidate = await send({ body: JSON.stringify({ labelled_test_input: true }), headers: validHeaders, timeoutMs: probeTimeout });
  record("request.missing_candidate", "Intentional failure: a request without candidate is refused (400) with no verdict.", true, inProbeBound(noCandidate, refused(noCandidate, 400)), noCandidate);

  const wrongMethod = await send({ method: "GET", headers: validHeaders, timeoutMs: probeTimeout });
  record("request.method_not_allowed", "Intentional failure: GET is refused (405) with no verdict.", true, inProbeBound(wrongMethod, refused(wrongMethod, 405)), wrongMethod);

  const plainText = await send({
    body: JSON.stringify({ candidate: "Labelled test input: plain model text with no structure." }),
    headers: validHeaders,
    timeoutMs: evaluationTimeout,
  });
  record("mapping.plain_model_text", "Test input: plain model text gets a valid VerifierResult.", false, inEvaluationBound(plainText, validResult(plainText)), plainText);

  const verdicts = new Map();
  for (const labelled of labelledCases) {
    const observed = await send({
      body: JSON.stringify({ candidate: labelled.candidate }),
      headers: validHeaders,
      timeoutMs: evaluationTimeout,
    });
    verdicts.set(labelled.id, observed.verdict);
    record(
      `labelled.${labelled.id}`,
      `Placement case: ${labelled.label}`,
      labelled.expect.technical_failure !== undefined,
      inEvaluationBound(observed, matchesLabelledExpectation(observed, labelled.expect)),
      observed,
    );
    if (isStructured(labelled.candidate)) {
      const asModelText = await send({
        body: JSON.stringify({ candidate: JSON.stringify(labelled.candidate) }),
        headers: validHeaders,
        timeoutMs: evaluationTimeout,
      });
      // The labelled expectation applies to both representations, and the two
      // results must match in full: verdict, quality, anchors and metrics.
      const mismatch =
        matchesLabelledExpectation(asModelText, labelled.expect)
        ?? (canonicalVerdict(asModelText.verdict) !== canonicalVerdict(observed.verdict)
          ? "the same output as model text and as agent JSON got different results (verdict, quality, anchors or metrics)"
          : null);
      record(
        `mapping.model_text_matches_agent_json.${labelled.id}`,
        `Placement case ${labelled.id} sent as model text gets the same result, anchors included, as agent JSON.`,
        false,
        inEvaluationBound(asModelText, mismatch),
        asModelText,
      );
    }
  }
  return verdicts;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function createRecorder() {
  const cases = [];
  const record = (id, description, intentionalFailure, failure, observed, status) => {
    cases.push({
      id,
      description,
      input: intentionalFailure ? "intentional_failure" : "test_input",
      outcome: status ?? (failure === null ? "passed" : "failed"),
      ...(failure !== null ? { reason: failure } : {}),
      ...(observed !== null && observed !== undefined ? { observed } : {}),
    });
  };
  return { cases, record };
}

function containsSecret(value, secrets) {
  if (typeof value === "string") return secrets.some((secret) => value.includes(secret));
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry, secrets));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([name, entry]) => containsSecret(name, secrets) || containsSecret(entry, secrets),
    );
  }
  return false;
}

/**
 * Refuses a report that would disclose any credential the run held. Checks
 * the decoded strings and property names (JSON escaping hides a key with a
 * quote or backslash from a search of the serialized text), and also every
 * rendering the kit produces, where adjacent fields are concatenated.
 */
export function assertReportHasNoCredentials(report, secrets) {
  const presentSecrets = secrets.filter((secret) => typeof secret === "string" && secret !== "");
  if (presentSecrets.length === 0) return;
  const renderings = [JSON.stringify(report), JSON.stringify(report, null, 2), formatKitReport(report)];
  if (containsSecret(report, presentSecrets) || containsSecret(renderings, presentSecrets)) {
    throw new KitCredentialLeakError();
  }
}

function buildReport({ targetDescription, accessMode, cases, secrets }) {
  const failed = cases.filter((entry) => entry.outcome === "failed").length;
  const passed = cases.filter((entry) => entry.outcome === "passed").length;
  const report = {
    kit: { name: KIT_NAME, version: KIT_VERSION },
    adapter_under_local_test: targetDescription.kind === "local" ? { name: ADAPTER_NAME, version: ADAPTER_VERSION } : null,
    target: targetDescription,
    access_mode: accessMode,
    scope_note: SCOPE_NOTE,
    summary: { passed, failed, not_applicable: cases.length - passed - failed },
    passed: failed === 0,
    cases,
  };
  assertReportHasNoCredentials(report, secrets);
  return report;
}

function generatedKey(purpose) {
  return `kit-${purpose}-${randomBytes(24).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   target:
 *     | { kind: "local", runHardCheck: (candidate: unknown) => unknown, scoreQuality: (candidate: unknown) => unknown, limits?: object }
 *     | { kind: "deployed", url: string, authorizedEndpointTest: boolean },
 *   access:
 *     | { mode: "public" }
 *     | { mode: "authenticated", key?: string, overlapKeys?: string[], retiredKeys?: string[] },
 *   labelledCases: Array<{ id: string, label: string, candidate: unknown, expect: { is_correct?: boolean, quality_score?: { min?: number, max?: number }, anchor_results?: Record<string, boolean>, technical_failure?: { status: 500 | 504 } } }>,
 *   bounds?: { probeMs?: number, evaluationMs?: number },
 * }} options
 */
export async function runCompatibilityKit(options) {
  const target = options?.target;
  const accessOption = options?.access;
  if (accessOption?.mode !== "public" && accessOption?.mode !== "authenticated") {
    throw new KitUsageError("Choose the endpoint's access mode explicitly: public or authenticated.");
  }
  validateLabelledCases(options.labelledCases);
  const bounds = { ...MILLWORK_BOUNDS, ...(options.bounds ?? {}) };

  if (target?.kind === "deployed") return runDeployed(target, accessOption, options.labelledCases, bounds);
  if (target?.kind === "local") return runLocal(target, accessOption, options.labelledCases, bounds);
  throw new KitUsageError("Choose a target: local (your check in this process) or deployed (an https URL).");
}

async function runDeployed(target, accessOption, labelledCases, bounds) {
  // Checked before anything is sent: no request leaves without authorization.
  if (target.authorizedEndpointTest !== true) throw new KitAuthorizationRequiredError();
  const url = validateDeployedUrl(target.url);

  const access = { mode: accessOption.mode };
  const overlapKeys = keyList(accessOption.overlapKeys, "overlapKeys");
  const retiredKeys = keyList(accessOption.retiredKeys, "retiredKeys");
  if (access.mode === "authenticated") {
    if (typeof accessOption.key !== "string" || accessOption.key === "") {
      throw new KitUsageError("Authenticated access needs the key the endpoint currently accepts.");
    }
    access.currentKey = accessOption.key;
    access.wrongKey = generatedKey("intentional-wrong-key");
  } else if (overlapKeys.length > 0 || retiredKeys.length > 0) {
    throw new KitUsageError("Overlapping and retired keys only apply to authenticated access.");
  }

  const { cases, record } = createRecorder();
  const send = async (request) => observe(await sendRequest(url.href, request));
  await runSharedCases({ send, access, bounds, labelledCases, record });

  const probeTimeout = bounds.probeMs + 1_000;
  for (const [index, key] of overlapKeys.entries()) {
    const observed = await send({ body: probeBody, headers: bearer(key), timeoutMs: probeTimeout });
    record(`access.overlap_key_accepted.${index + 1}`, `Overlapping key ${index + 1} is accepted during rotation.`, false, failClosed(observed) ?? withinBound(observed, bounds.probeMs, "registration probe bound"), observed);
  }
  for (const [index, key] of retiredKeys.entries()) {
    const observed = await send({ body: probeBody, headers: bearer(key), timeoutMs: probeTimeout });
    record(`access.retired_key_rejected.${index + 1}`, `Intentional failure: retired key ${index + 1} is rejected (401) when presented directly.`, true, refused(observed, 401) ?? withinBound(observed, bounds.probeMs, "registration probe bound"), observed);
  }

  return buildReport({
    targetDescription: { kind: "deployed", endpoint: `${url.origin}${url.pathname}` },
    accessMode: access.mode,
    cases,
    secrets: [access.currentKey ?? "", access.wrongKey ?? "", ...overlapKeys, ...retiredKeys],
  });
}

async function serveLocally(listener) {
  const server = createServer((request, response) => {
    void listener(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function runLocal(target, accessOption, labelledCases, bounds) {
  if (typeof target.runHardCheck !== "function" || typeof target.scoreQuality !== "function") {
    throw new KitUsageError("A local run needs runHardCheck and scoreQuality: the check functions you already use.");
  }
  // Local keys are generated for this run only, so the same authentication
  // path is exercised without the developer handling any credential.
  const currentKey = generatedKey("local-current");
  const replacementKey = generatedKey("local-replacement");
  const wrongKey = generatedKey("intentional-wrong-key");
  let acceptedKeys = [currentKey];
  const access =
    accessOption.mode === "authenticated"
      ? { mode: "authenticated", currentKey, wrongKey }
      : { mode: "public" };
  const adapterAccess =
    accessOption.mode === "authenticated" ? authenticatedAccess({ acceptedKeys: () => acceptedKeys }) : publicAccess();

  const { cases, record } = createRecorder();
  const probeTimeout = bounds.probeMs + 1_000;
  const serveWith = (hooks, limits) =>
    serveLocally(createOutputCheckRequestListener({ access: adapterAccess, limits: limits ?? target.limits, ...hooks }));

  const primary = await serveWith({ runHardCheck: target.runHardCheck, scoreQuality: target.scoreQuality });
  let verdicts;
  try {
    const send = async (request) => observe(await sendRequest(primary.url, request));
    verdicts = await runSharedCases({ send, access, bounds, labelledCases, record });

    if (access.mode === "authenticated") {
      acceptedKeys = [currentKey, replacementKey];
      const oldDuringOverlap = await send({ body: probeBody, headers: bearer(currentKey), timeoutMs: probeTimeout });
      const newDuringOverlap = await send({ body: probeBody, headers: bearer(replacementKey), timeoutMs: probeTimeout });
      record(
        "access.overlap_accepts_both_keys",
        "During rotation both the old and the replacement key are accepted, with no source edit.",
        false,
        failClosed(oldDuringOverlap)
          ?? failClosed(newDuringOverlap)
          ?? withinBound(oldDuringOverlap, bounds.probeMs, "registration probe bound")
          ?? withinBound(newDuringOverlap, bounds.probeMs, "registration probe bound"),
        newDuringOverlap,
      );
      acceptedKeys = [replacementKey];
      const retired = await send({ body: probeBody, headers: bearer(currentKey), timeoutMs: probeTimeout });
      const replacement = await send({ body: probeBody, headers: bearer(replacementKey), timeoutMs: probeTimeout });
      record(
        "access.removed_key_rejected",
        "Intentional failure: after removal the old key is rejected (401) when presented directly; the replacement still works.",
        true,
        refused(retired, 401)
          ?? failClosed(replacement)
          ?? withinBound(retired, bounds.probeMs, "registration probe bound")
          ?? withinBound(replacement, bounds.probeMs, "registration probe bound"),
        retired,
      );
    }
  } finally {
    await primary.close();
  }

  await runTechnicalFailureCases({ serveWith, validHeaders: access.mode === "authenticated" ? () => bearer(acceptedKeys[0]) : () => ({}), record });
  await runJudgeNoninterference({ serveWith, target, labelledCases, verdicts, validHeaders: access.mode === "authenticated" ? () => bearer(acceptedKeys[0]) : () => ({}), bounds, record });

  return buildReport({
    targetDescription: { kind: "local", endpoint: "loopback, this process" },
    accessMode: access.mode,
    cases,
    secrets: [currentKey, replacementKey, wrongKey],
  });
}

/** The adapter's own answers when a check breaks: never an invented verdict. */
async function runTechnicalFailureCases({ serveWith, validHeaders, record }) {
  const failures = [
    {
      id: "failure.check_throws",
      description: "Intentional failure: a check that throws is answered 500 with no verdict.",
      hooks: { runHardCheck: () => { throw new Error("labelled intentional failure"); }, scoreQuality: () => 0.5 },
      status: 500,
    },
    {
      id: "failure.check_timeout",
      description: "Intentional failure: a check that never finishes is answered 504 at the adapter deadline, with no verdict.",
      hooks: { runHardCheck: () => new Promise(() => {}), scoreQuality: () => 0.5 },
      status: 504,
      limits: { checkTimeoutMs: 100 },
    },
    {
      id: "failure.invalid_check_result",
      description: "Intentional failure: a check result that is not a VerifierResult is answered 500 with no verdict.",
      hooks: { runHardCheck: () => ({ is_correct: "yes" }), scoreQuality: () => 2 },
      status: 500,
    },
  ];
  for (const failure of failures) {
    const running = await serveWith(failure.hooks, failure.limits);
    try {
      const observed = observe(
        await sendRequest(running.url, {
          body: JSON.stringify({ candidate: { labelled_test_input: failure.id } }),
          headers: validHeaders(),
          timeoutMs: 5_000,
        }),
      );
      record(failure.id, failure.description, true, refused(observed, failure.status), observed);
    } finally {
      await running.close();
    }
  }
}

/**
 * Replacing only the quality scorer must not change any hard verdict. Run
 * locally, where the scorer can be swapped without touching the check.
 */
async function runJudgeNoninterference({ serveWith, target, labelledCases, verdicts, validHeaders, bounds, record }) {
  const mismatches = [];
  for (const forcedScore of [0, 1]) {
    const running = await serveWith({ runHardCheck: target.runHardCheck, scoreQuality: () => forcedScore });
    try {
      for (const labelled of labelledCases) {
        const observed = observe(
          await sendRequest(running.url, {
            body: JSON.stringify({ candidate: labelled.candidate }),
            headers: validHeaders(),
            timeoutMs: bounds.evaluationMs + 1_000,
          }),
        );
        if (observed.verdict?.is_correct !== verdicts.get(labelled.id)?.is_correct) {
          mismatches.push(`${labelled.id} with quality forced to ${forcedScore}`);
        }
      }
    } finally {
      await running.close();
    }
  }
  record(
    "judge.noninterference",
    "Changing only the quality scorer (forced to 0, then 1) leaves every placement case's is_correct unchanged.",
    false,
    mismatches.length === 0 ? null : `is_correct changed for ${mismatches.join(", ")}`,
    null,
  );
}

/** Plain-text rendering for a terminal. Never includes a credential. */
export function formatKitReport(report) {
  const lines = [
    `${report.kit.name} ${report.kit.version}: ${report.target.kind} endpoint (${report.target.endpoint}), ${report.access_mode} access`,
    report.scope_note,
    "",
  ];
  for (const entry of report.cases) {
    const marker = entry.outcome === "passed" ? "PASS" : entry.outcome === "failed" ? "FAIL" : "N/A ";
    lines.push(`${marker}  ${entry.id}`);
    lines.push(`      ${entry.description}`);
    if (entry.reason !== undefined) lines.push(`      ${entry.reason}`);
  }
  lines.push("");
  const { passed, failed, not_applicable: notApplicable } = report.summary;
  lines.push(`${passed} passed, ${failed} failed${notApplicable > 0 ? `, ${notApplicable} not applicable` : ""}.`);
  return lines.join("\n");
}
