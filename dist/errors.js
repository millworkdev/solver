/**
 * Thrown for every non-2xx response. Carries the parsed Problem body
 * verbatim -- no string-parsing of `message` is ever required by a caller,
 * per the SDK documentation's Errors section.
 */
export class SolverApiError extends Error {
    type;
    status;
    detail;
    instance;
    errors;
    retryAfterS;
    constructor(problem) {
        super(problem.title);
        this.name = "SolverApiError";
        this.type = problem.type;
        this.status = problem.status;
        this.detail = problem.detail;
        this.instance = problem.instance;
        this.errors = problem.errors;
        this.retryAfterS = problem.retry_after_s;
    }
}
/**
 * Thrown when a response could not be parsed as a Problem body at all (a
 * network failure that produced no body, or a genuinely non-conformant
 * server response) -- kept distinct from SolverApiError so callers can tell
 * "the server told me it failed" apart from "something below HTTP broke".
 */
export class SolverApiNetworkError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.name = "SolverApiNetworkError";
        this.cause = cause;
    }
}
