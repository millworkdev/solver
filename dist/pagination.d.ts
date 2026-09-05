import type { Paginated } from "./types.js";
/**
 * Wraps a raw `{ items, nextCursor }` page with a `.next()` that re-issues
 * the same list call at the next cursor -- never auto-fetches further
 * pages itself, per the SDK documentation's "no hidden logic" rule.
 */
export declare function toPaginated<T>(items: T[], nextCursor: string | null, fetchNext: (cursor: string) => Promise<Paginated<T>>): Paginated<T>;
