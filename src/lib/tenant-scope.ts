/**
 * Multi-tenant scope helpers.
 * Canonical key: barrioOrg = "barrio|organización"
 *
 * Use requireBarrioOrg() before every client create/write of domain data so
 * documents are never stored without a tenant key (Firestore rules also enforce
 * isSameBarrio on create).
 */

export function isValidBarrioOrg(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v.includes('|') && !v.startsWith('|') && !v.endsWith('|') && v.length >= 3;
}

/**
 * Throws if barrioOrg is missing/invalid. Returns trimmed value.
 */
export function requireBarrioOrg(
  value: unknown,
  context = 'Usuario sin barrio/organización. No se puede guardar el registro.'
): string {
  if (!isValidBarrioOrg(value)) {
    throw new Error(context);
  }
  return (value as string).trim();
}

/**
 * Merge data with a validated barrioOrg (always overwrites client-supplied value).
 */
export function withTenantScope<T extends Record<string, unknown>>(
  data: T,
  barrioOrg: unknown
): T & { barrioOrg: string } {
  return {
    ...data,
    barrioOrg: requireBarrioOrg(barrioOrg),
  };
}
