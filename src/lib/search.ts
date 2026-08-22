/**
 * Case-insensitive substring match for list and ⌘K search filters.
 *
 * PostgreSQL's LIKE is case-sensitive. SQLite's is not, for ASCII, which meant
 * the original build got case-insensitive search for free and every call site
 * simply passed `{ contains: query }`. On Postgres that silently becomes an
 * exact-case match — searching "acme" stops finding "Acme Ltd." — so the mode
 * has to be explicit. Keeping it in one helper means there is a single place to
 * revisit if this ever moves to a trigram or full-text index.
 */
export function contains(query: string) {
  return { contains: query, mode: "insensitive" as const };
}
