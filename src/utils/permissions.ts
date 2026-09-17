/**
 * Returns the entries of `required` that are not present in `granted`.
 * Order follows `required` so error messages are deterministic.
 */
export function missingPermissions(
  required: readonly string[],
  granted: readonly string[],
): string[] {
  const grantedSet = new Set(granted);
  return required.filter((permission) => !grantedSet.has(permission));
}
