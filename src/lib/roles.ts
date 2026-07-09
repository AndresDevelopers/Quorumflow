export type UserRole = 'user' | 'counselor' | 'president' | 'secretary' | 'other';

export type UserPermission = 'read' | 'all';

export const normalizePermission = (permission?: unknown): UserPermission => {
  if (typeof permission !== 'string') return 'read';
  const normalized = permission.trim().toLowerCase();
  if (normalized === 'all' || normalized === 'todo') return 'all';
  return 'read';
};

export const canWrite = (permission: UserPermission | null | undefined): boolean =>
  permission === 'all';

export const getDefaultPermission = (role: UserRole): UserPermission =>
  role === 'user' || role === 'other' ? 'read' : 'all';

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

export const canViewSettings = (role: UserRole): boolean =>
  hasLeadershipPrivileges(role);

export const isAdmin = (role: UserRole | null | undefined): boolean =>
  role === settingsAdminRole || role === 'president';
