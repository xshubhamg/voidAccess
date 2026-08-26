/**
 * Walks an error's `cause` chain looking for PostgreSQL's unique_violation
 * SQLSTATE (23505). Drizzle wraps driver errors, so the code can sit at any
 * depth.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
