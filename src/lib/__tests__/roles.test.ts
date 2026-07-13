import {
  canManageSettings,
  hasLeadershipPrivileges,
  canViewSettings,
  normalizeRole,
  normalizePermission,
  canWrite,
  getDefaultPermission,
  resolvePermissionForRoleChange,
} from '@/lib/roles';
import type { UserRole } from '@/lib/roles';

describe('normalizeRole', () => {
  it('normalizes roles correctly', () => {
    expect(normalizeRole('secretary')).toBe('secretary');
    expect(normalizeRole('admin')).toBe('secretary');
    expect(normalizeRole('president')).toBe('president');
    expect(normalizeRole('presidente')).toBe('president');
    expect(normalizeRole('counselor')).toBe('counselor');
    expect(normalizeRole('consejero')).toBe('counselor');
    expect(normalizeRole('consejera')).toBe('counselor');
    expect(normalizeRole('other')).toBe('other');
    expect(normalizeRole('otro')).toBe('other');
  });

  it('defaults to user for unknown roles', () => {
    expect(normalizeRole('unknown')).toBe('user');
    expect(normalizeRole('')).toBe('user');
    expect(normalizeRole(undefined)).toBe('user');
    expect(normalizeRole(null)).toBe('user');
  });
});

describe('normalizePermission', () => {
  it('maps write aliases to all', () => {
    expect(normalizePermission('all')).toBe('all');
    expect(normalizePermission('ALL')).toBe('all');
    expect(normalizePermission('todo')).toBe('all');
    expect(normalizePermission('todos')).toBe('all');
    expect(normalizePermission(' Todo ')).toBe('all');
  });

  it('maps read aliases to read', () => {
    expect(normalizePermission('read')).toBe('read');
    expect(normalizePermission('lectura')).toBe('read');
    expect(normalizePermission('LECTURA')).toBe('read');
  });

  it('defaults to read for missing or unknown values', () => {
    expect(normalizePermission(undefined)).toBe('read');
    expect(normalizePermission(null)).toBe('read');
    expect(normalizePermission('')).toBe('read');
    expect(normalizePermission('write')).toBe('read');
    expect(normalizePermission(123)).toBe('read');
  });
});

describe('canWrite', () => {
  it('allows only all permission', () => {
    expect(canWrite('all')).toBe(true);
    expect(canWrite('read')).toBe(false);
    expect(canWrite(null)).toBe(false);
    expect(canWrite(undefined)).toBe(false);
  });
});

describe('getDefaultPermission', () => {
  it('returns read for restricted roles and all for leadership', () => {
    expect(getDefaultPermission('user')).toBe('read');
    expect(getDefaultPermission('other')).toBe('read');
    expect(getDefaultPermission('counselor')).toBe('all');
    expect(getDefaultPermission('president')).toBe('all');
    expect(getDefaultPermission('secretary')).toBe('all');
  });
});

describe('resolvePermissionForRoleChange', () => {
  it('forces read when demoting to user or other', () => {
    expect(resolvePermissionForRoleChange('secretary', 'user', 'all')).toBe('read');
    expect(resolvePermissionForRoleChange('president', 'other', 'all')).toBe('read');
  });

  it('applies role default when promoting from restricted roles', () => {
    expect(resolvePermissionForRoleChange('user', 'counselor', 'read')).toBe('all');
    expect(resolvePermissionForRoleChange('other', 'president', 'read')).toBe('all');
    expect(resolvePermissionForRoleChange('user', 'other', 'read')).toBe('read');
  });

  it('preserves custom Lectura/Todo between leadership roles', () => {
    expect(resolvePermissionForRoleChange('counselor', 'president', 'read')).toBe('read');
    expect(resolvePermissionForRoleChange('president', 'secretary', 'all')).toBe('all');
    expect(resolvePermissionForRoleChange('secretary', 'counselor', 'read')).toBe('read');
  });
});

describe('canManageSettings', () => {
  it('allows secretary to manage settings', () => {
    expect(canManageSettings('secretary')).toBe(true);
  });

  it('denies other roles from managing settings', () => {
    expect(canManageSettings('president' as UserRole)).toBe(false);
    expect(canManageSettings('counselor' as UserRole)).toBe(false);
    expect(canManageSettings('user' as UserRole)).toBe(false);
    expect(canManageSettings('other' as UserRole)).toBe(false);
  });
});

describe('hasLeadershipPrivileges', () => {
  it('returns true for leadership roles', () => {
    expect(hasLeadershipPrivileges('secretary')).toBe(true);
    expect(hasLeadershipPrivileges('president')).toBe(true);
    expect(hasLeadershipPrivileges('counselor')).toBe(true);
  });

  it('returns false for non-leadership roles', () => {
    expect(hasLeadershipPrivileges('user')).toBe(false);
    expect(hasLeadershipPrivileges('other')).toBe(false);
  });
});

describe('canViewSettings', () => {
  it('allows all roles to view personal settings', () => {
    expect(canViewSettings('secretary')).toBe(true);
    expect(canViewSettings('president')).toBe(true);
    expect(canViewSettings('counselor')).toBe(true);
    expect(canViewSettings('user')).toBe(true);
    expect(canViewSettings('other')).toBe(true);
  });
});
