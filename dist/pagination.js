/**
 * Wraps a raw `{ items, nextCursor }` page with a `.next()` that re-issues
 * the same list call at the next cursor -- never auto-fetches further
 * pages itself, per the SDK documentation's "no hidden logic" rule.
 */
export function toPaginated(items, nextCursor, fetchNext) {
    return {
        items,
        nextCursor,
        async next() {
            if (nextCursor === null) {
                return toPaginated([], null, fetchNext);
            }
            return fetchNext(nextCursor);
        },
    };
}
