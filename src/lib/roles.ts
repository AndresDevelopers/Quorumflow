export type UserRole = 'user' | 'counselor' | 'president' | 'secretary' | 'other';

export type UserPermission = 'read' | 'all';

/**
 * Canonical permission values accepted in Firestore and the UI.
 * Aliases cover Spanish labels and legacy typos that may exist in older docs.
 */
const WRITE_PERMISSION_ALIASES = new Set(['all', 'todo', 'todos']);
const READ_PERMISSION_ALIASES = new Set(['read', 'lectura']);

export const normalizePermission = (permission?: unknown): UserPermission => {
  if (typeof permission !== 'string') return 'read';
  const normalized = permission.trim().toLowerCase();
  if (WRITE_PERMISSION_ALIASES.has(normalized)) return 'all';
  if (READ_PERMISSION_ALIASES.has(normalized)) return 'read';
  return 'read';
};

export const canWrite = (permission: UserPermission | null | undefined): boolean =>
  permission === 'all';

export const getDefaultPermission = (role: UserRole): UserPermission =>
  role === 'user' || role === 'other' ? 'read' : 'all';

/**
 * Resolve the permission to store when an admin changes a user's role.
 * - Demote to `user` / `other` → force `read` (restricted roles).
 * - Promote from restricted role → apply the new role default (`all` for leadership).
 * - Move between leadership roles → keep the custom permission (Lectura/Todo).
 */
export const resolvePermissionForRoleChange = (
  previousRole: UserRole,
  newRole: UserRole,
  previousPermission?: UserPermission | null
): UserPermission => {
  if (newRole === 'user' || newRole === 'other') {
    return 'read';
  }

  const wasRestricted = previousRole === 'user' || previousRole === 'other';
  if (wasRestricted) {
    return getDefaultPermission(newRole);
  }

  // Leadership → leadership: preserve admin-assigned Lectura/Todo
  return previousPermission === 'all' || previousPermission === 'read'
    ? previousPermission
    : getDefaultPermission(newRole);
};

export const PERMISSION_META: Record<UserPermission, { i18nKey: string }> = {
  read: { i18nKey: 'permission.read' },
  all:  { i18nKey: 'permission.all' },
};

export const normalizeRole = (role?: unknown): UserRole => {
  if (typeof role !== 'string') {
    return 'user';
  }

  const normalized = role.trim().toLowerCase();

  if (normalized === 'secretary' || normalized === 'admin') {
    return 'secretary';
  }

  if (normalized === 'president' || normalized === 'presidente') {
    return 'president';
  }

  if (
    normalized === 'counselor' ||
    normalized === 'consejero' ||
    normalized === 'consejera'
  ) {
    return 'counselor';
  }

  if (normalized === 'other' || normalized === 'otro') {
    return 'other';
  }

  return 'user';
};

export const assignableRoles: readonly UserRole[] = [
  'user',
  'counselor',
  'president',
  'secretary',
  'other',
];

export const leadershipRoles: readonly UserRole[] = [
  'secretary',
  'president',
  'counselor',
];

export const settingsAdminRole: UserRole = 'secretary';

export const roleVisibilityDocId = 'role_visibility';

export const canManageSettings = (role: UserRole): boolean =>
  role === settingsAdminRole;

export const hasLeadershipPrivileges = (role: UserRole): boolean =>
  leadershipRoles.includes(role);

/**
 * Settings is a personal page (profile, security, theme, notifications).
 * Every authenticated role may view and edit their own settings.
 */
export const canViewSettings = (_role: UserRole): boolean => true;

export const isAdmin = (role: UserRole | null | undefined): boolean =>
  role === settingsAdminRole || role === 'president';
