/**
 * Framework-neutral output-check adapter.
 *
 * Drop this into an app you already run. Replace `listingExtractionHardCheck`
 * and `listingQualityScore` with the functions you already trust. Keep those
 * functions unchanged; this file only translates to Millwork's candidate POST
 * and VerifierResult JSON, and decides who may call it.
 *
 * This is not a Millwork-hosted checker and not a named-supplier adapter.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const ADAPTER_NAME = "millwork-output-check-adapter";
export const ADAPTER_VERSION = "1.0.0";

export const RESERVED_PROBE = { solverapi_probe: "registration_preflight" };

/** The variable an authenticated deployment reads its accepted keys from. */
export const DEFAULT_KEYS_ENVIRONMENT_VARIABLE = "MILLWORK_VERIFIER_KEYS";

/**
 * Millwork waits 10 s for an evaluation. The check deadline sits below that so
 * a slow check ends as this adapter's own diagnosable 504, not as a Millwork
 * timeout with no response. The reserved probe never runs the check, so it
 * answers well inside Millwork's 3 s probe bound.
 */
export const DEFAULT_LIMITS = Object.freeze({
  maxBodyBytes: 1_048_576,
  bodyReadTimeoutMs: 5_000,
  checkTimeoutMs: 8_000,
});

// Millwork account API keys authenticate a caller TO Millwork. An endpoint key
// authenticates Millwork to this endpoint and nothing else, so configuring one
// here is a mistake worth refusing rather than serving.
const MILLWORK_ACCOUNT_KEY_PREFIX = "solverapi_live_";

export function isReservedProbe(candidate) {
  return (
    candidate !== null
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && Object.keys(candidate).length === 1
    && candidate.solverapi_probe === "registration_preflight"
  );
}

export function containsProbeMarker(value) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(current, "solverapi_probe")) return true;
    for (const child of Object.values(current)) pending.push(child);
  }
  return false;
}

/**
 * Model arms deliver a text candidate. Agent arms may deliver structured
 * JSON. Parse a JSON object/array string; treat other text as `{ summary }`;
 * fail closed on an unparseable `{` or `[` payload.
 *
 * @param {unknown} candidate
 * @returns {{ ok: true, candidate: unknown } | { ok: false }}
 */
export function normalizeOutputCheckCandidate(candidate) {
  if (typeof candidate !== "string") {
    return { ok: true, candidate };
  }
  const trimmed = candidate.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { ok: true, candidate: JSON.parse(trimmed) };
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, candidate: { summary: candidate } };
}

/** The check returned something that is not a VerifierResult. Answered as a
 *  technical failure: inventing a verdict from a broken result would hide it. */
export class OutputCheckResultError extends Error {
  constructor(reason) {
    super(`check result is not a valid VerifierResult: ${reason}`);
    this.name = "OutputCheckResultError";
  }
}

/** The check did not settle within the adapter's deadline. */
export class OutputCheckTimeoutError extends Error {
  constructor() {
    super("check did not finish within the adapter deadline");
    this.name = "OutputCheckTimeoutError";
  }
}

const FAIL_CLOSED_RESULT = Object.freeze({ is_correct: false, quality_score: 0 });

/**
 * Decides, before any customer code runs, whether a candidate gets a fixed
 * fail-closed verdict (unparseable JSON-looking text, the reserved probe, or
 * a probe marker anywhere after parsing) or goes to the check.
 */
function classifyCandidate(candidate) {
  const normalized = normalizeOutputCheckCandidate(candidate);
  if (!normalized.ok) return { kind: "fixed", result: { ...FAIL_CLOSED_RESULT } };
  if (isReservedProbe(normalized.candidate) || containsProbeMarker(normalized.candidate)) {
    return { kind: "fixed", result: { ...FAIL_CLOSED_RESULT } };
  }
  return { kind: "check", candidate: normalized.candidate };
}

function assembleVerifierResult(hard, quality) {
  if (hard === null || typeof hard !== "object" || Array.isArray(hard)) {
    throw new OutputCheckResultError("the hard check must return an object");
  }
  if (typeof hard.is_correct !== "boolean") {
    throw new OutputCheckResultError("is_correct must be a boolean");
  }
  if (typeof quality !== "number" || !Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new OutputCheckResultError("quality_score must be a number from 0 to 1");
  }
  if (hard.anchor_results !== undefined) {
    const anchors = hard.anchor_results;
    if (anchors === null || typeof anchors !== "object" || Array.isArray(anchors)) {
      throw new OutputCheckResultError("anchor_results must be an object of booleans");
    }
    for (const value of Object.values(anchors)) {
      if (typeof value !== "boolean") {
        throw new OutputCheckResultError("anchor_results must be an object of booleans");
      }
    }
  }
  return {
    is_correct: hard.is_correct,
    quality_score: quality,
    ...(hard.anchor_results !== undefined ? { anchor_results: hard.anchor_results } : {}),
  };
}

/**
 * Synchronous mapping for synchronous checks. Throws OutputCheckResultError
 * when the check returns something that is not a VerifierResult.
 *
 * @param {unknown} candidate
 * @param {{ runHardCheck: (candidate: unknown) => { is_correct: boolean, anchor_results?: Record<string, boolean> }, scoreQuality: (candidate: unknown) => number }} options
 */
export function evaluateOutputCheck(candidate, options) {
  const classified = classifyCandidate(candidate);
  if (classified.kind === "fixed") return classified.result;
  return assembleVerifierResult(
    options.runHardCheck(classified.candidate),
    options.scoreQuality(classified.candidate),
  );
}

/**
 * Same mapping for synchronous or asynchronous checks, under a deadline.
 * The deadline bounds waiting, not work: it cannot interrupt a synchronous
 * loop, so keep blocking computation out of the request path.
 */
export async function runOutputCheck(candidate, options) {
  const classified = classifyCandidate(candidate);
  if (classified.kind === "fixed") return classified.result;
  const checked = classified.candidate;
  const work = Promise.all([
    Promise.resolve().then(() => options.runHardCheck(checked)),
    Promise.resolve().then(() => options.scoreQuality(checked)),
  ]);
  const timeoutMs = options.checkTimeoutMs ?? DEFAULT_LIMITS.checkTimeoutMs;
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new OutputCheckTimeoutError()), timeoutMs);
  });
  try {
    const [hard, quality] = await Promise.race([work, deadline]);
    return assembleVerifierResult(hard, quality);
  } finally {
    clearTimeout(timer);
    // A check that loses the race may still reject later; that outcome is
    // already answered, so it must not surface as an unhandled rejection.
    work.catch(() => {});
  }
}

/** Labelled existing-check: required numeric `extracted_fields.price`. */
export function listingExtractionHardCheck(candidate) {
  const price = candidate?.extracted_fields?.price;
  const anchors = {
    has_required_field_price: typeof price === "number",
    price_is_positive_number: typeof price === "number" && price > 0,
  };
  return { is_correct: Object.values(anchors).every(Boolean), anchor_results: anchors };
}

/** Authentic quality from existing text length; not a placeholder. */
export function listingQualityScore(candidate) {
  const text = String(candidate?.summary ?? "");
  return Math.min(1, text.length / 200);
}

/** Secondary educational path: always incorrect, still a real quality score. */
export function emptyFailClosedHardCheck() {
  return {
    is_correct: false,
    anchor_results: { empty_fail_closed_module: true },
  };
}

// ---------------------------------------------------------------------------
// Endpoint access
// ---------------------------------------------------------------------------

/** No credential: anyone who can reach the URL can call it. Chosen explicitly. */
export function publicAccess() {
  return Object.freeze({ mode: "public" });
}

/**
 * Only callers presenting one of the accepted keys as a Bearer token get
 * through. `acceptedKeys` is read on every request, so adding a replacement
 * key and later removing the old one is a configuration change, never a
 * source edit.
 *
 * @param {{ acceptedKeys: (() => string[]) | string[] }} options
 */
export function authenticatedAccess(options) {
  const source = options?.acceptedKeys;
  if (typeof source !== "function" && !Array.isArray(source)) {
    throw new TypeError("authenticatedAccess needs acceptedKeys: a list of keys or a function returning one");
  }
  const acceptedKeys = typeof source === "function" ? source : () => source;
  return Object.freeze({ mode: "authenticated", acceptedKeys });
}

/** Splits a configured key list on commas or newlines, dropping blanks. */
export function parseAcceptedKeys(raw) {
  if (typeof raw !== "string") return [];
  return raw.split(/[,\n]/).map((key) => key.trim()).filter((key) => key !== "");
}

/**
 * Accepted keys from one environment variable, e.g. `MILLWORK_VERIFIER_KEYS=
 * <current>` or, while rotating, `<current>,<replacement>`. Re-read per
 * request; whether a changed value reaches a running process is up to the
 * host (many platforms restart on a variable change).
 */
export function keysFromEnvironment(variableName = DEFAULT_KEYS_ENVIRONMENT_VARIABLE, environment = process.env) {
  return () => parseAcceptedKeys(environment[variableName]);
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Compares against every accepted key so timing does not reveal which one
 *  (or how many) matched. */
function presentedKeyIsAccepted(presented, acceptedKeys) {
  const presentedDigest = digest(presented);
  let accepted = false;
  for (const key of acceptedKeys) {
    if (timingSafeEqual(presentedDigest, digest(key))) accepted = true;
  }
  return accepted;
}

function bearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") return null;
  const separator = authorizationHeader.indexOf(" ");
  if (separator === -1) return null;
  if (authorizationHeader.slice(0, separator).toLowerCase() !== "bearer") return null;
  const token = authorizationHeader.slice(separator + 1).trim();
  return token === "" ? null : token;
}

/**
 * @returns {{ allowed: true } | { allowed: false, status: number, error: string }}
 */
function checkAccess(access, request) {
  if (access.mode === "public") return { allowed: true };
  let acceptedKeys;
  try {
    acceptedKeys = access.acceptedKeys();
  } catch {
    return { allowed: false, status: 503, error: "endpoint_keys_unavailable" };
  }
  if (!Array.isArray(acceptedKeys) || acceptedKeys.length === 0) {
    // Fail closed: an authenticated endpoint with no keys configured must not
    // quietly become a public one.
    return { allowed: false, status: 503, error: "endpoint_keys_not_configured" };
  }
  if (acceptedKeys.some((key) => typeof key !== "string" || key === "" || key.startsWith(MILLWORK_ACCOUNT_KEY_PREFIX))) {
    return { allowed: false, status: 503, error: "endpoint_keys_misconfigured" };
  }
  const presented = bearerToken(request.headers.authorization);
  if (presented === null || !presentedKeyIsAccepted(presented, acceptedKeys)) {
    return { allowed: false, status: 401, error: "unauthorized" };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// HTTP listener
// ---------------------------------------------------------------------------

class RequestBodyError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Reads the whole body (fixed-length or chunked) within a size and time bound. */
export function readBoundedBody(request, limits) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > limits.maxBodyBytes) {
      reject(new RequestBodyError(413, "request_too_large"));
      return;
    }
    const chunks = [];
    let received = 0;
    let settled = false;
    const finish = (settle) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new RequestBodyError(408, "request_timeout"))),
      limits.bodyReadTimeoutMs,
    );
    const onData = (chunk) => {
      received += chunk.length;
      if (received > limits.maxBodyBytes) {
        finish(() => reject(new RequestBodyError(413, "request_too_large")));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks).toString("utf8")));
    const onError = () => finish(() => reject(new RequestBodyError(400, "malformed_request")));
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

/** Kept for callers that read the JSON body themselves. */
export async function readJson(request) {
  return JSON.parse(await readBoundedBody(request, DEFAULT_LIMITS));
}

function resolveLimits(limits) {
  const resolved = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new TypeError(`limits.${name} must be a positive number`);
    }
  }
  return resolved;
}

/**
 * Node `http.IncomingMessage` listener. Framework-neutral: wrap it, or port
 * the same order to Express/Fastify/etc.
 *
 * Order matters: access is decided before the body is read, so the reserved
 * probe cannot be used to confirm the endpoint without a valid key, and a
 * probe marker is detected after text is parsed as well as before. Every
 * non-2xx answer carries `{ error }` and never a verdict, so nothing can
 * mistake a refused or failed request for a real evaluation.
 *
 * @param {{
 *   access: { mode: "public" } | { mode: "authenticated", acceptedKeys: () => string[] },
 *   runHardCheck?: (candidate: unknown) => unknown,
 *   scoreQuality?: (candidate: unknown) => unknown,
 *   limits?: Partial<typeof DEFAULT_LIMITS>,
 * }} options
 */
export function createOutputCheckRequestListener(options) {
  const access = options?.access;
  if (access?.mode !== "public" && access?.mode !== "authenticated") {
    throw new TypeError(
      "createOutputCheckRequestListener needs access: publicAccess() or authenticatedAccess({ acceptedKeys }). " +
        "There is no default, so an endpoint is never public by omission.",
    );
  }
  if (access.mode === "authenticated" && typeof access.acceptedKeys !== "function") {
    throw new TypeError("authenticated access needs acceptedKeys; build it with authenticatedAccess()");
  }
  const runHardCheck = options.runHardCheck ?? listingExtractionHardCheck;
  const scoreQuality = options.scoreQuality ?? listingQualityScore;
  const limits = resolveLimits(options.limits);

  return async (request, response) => {
    const send = (status, body, extraHeaders = {}) => {
      if (response.headersSent) return;
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...extraHeaders,
      });
      response.end(JSON.stringify(body));
    };
    const refuse = (status, error, extraHeaders) => send(status, { error }, extraHeaders);

    if (request.method !== "POST") {
      refuse(405, "method_not_allowed", { allow: "POST" });
      return;
    }

    const decision = checkAccess(access, request);
    if (!decision.allowed) {
      refuse(
        decision.status,
        decision.error,
        decision.status === 401 ? { "www-authenticate": "Bearer", connection: "close" } : { connection: "close" },
      );
      return;
    }

    let rawBody;
    try {
      rawBody = await readBoundedBody(request, limits);
    } catch (error) {
      const status = error instanceof RequestBodyError ? error.status : 400;
      const code = error instanceof RequestBodyError ? error.code : "malformed_request";
      refuse(status, code, { connection: "close" });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      refuse(400, "malformed_request");
      return;
    }
    if (
      payload === null
      || typeof payload !== "object"
      || Array.isArray(payload)
      || !Object.prototype.hasOwnProperty.call(payload, "candidate")
    ) {
      refuse(400, "missing_candidate");
      return;
    }

    let result;
    try {
      result = await runOutputCheck(payload.candidate, {
        runHardCheck,
        scoreQuality,
        checkTimeoutMs: limits.checkTimeoutMs,
      });
    } catch (error) {
      // The message is deliberately not echoed: a check's own error text can
      // quote the candidate, and the response should carry no content.
      if (error instanceof OutputCheckTimeoutError) refuse(504, "check_timeout");
      else if (error instanceof OutputCheckResultError) refuse(500, "check_result_invalid");
      else refuse(500, "check_failed");
      return;
    }
    send(200, result);
  };
}
