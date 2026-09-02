/**
 * Wire shape of an RFC-7807 Problem response, per the product contract's
 * error section and the backend's ProblemResponseBody wire shape.
 */
export interface FieldError {
    field: string;
    message: string;
}
export interface ProblemBody {
    type: string;
    title: string;
    status: number;
    detail?: string;
    instance: string;
    errors?: FieldError[];
    retry_after_s?: number;
}
/**
 * Thrown for every non-2xx response. Carries the parsed Problem body
 * verbatim -- no string-parsing of `message` is ever required by a caller,
 * per the SDK design's Errors section.
 */
export declare class SolverApiError extends Error {
    readonly type: string;
    readonly status: number;
    readonly detail?: string;
    readonly instance: string;
    readonly errors?: FieldError[];
    readonly retryAfterS?: number;
    constructor(problem: ProblemBody);
}
/**
 * Thrown when a response could not be parsed as a Problem body at all (a
 * network failure that produced no body, or a genuinely non-conformant
 * server response) -- kept distinct from SolverApiError so callers can tell
 * "the server told me it failed" apart from "something below HTTP broke".
 */
export declare class SolverApiNetworkError extends Error {
    readonly cause?: unknown;
    constructor(message: string, cause?: unknown);
}
