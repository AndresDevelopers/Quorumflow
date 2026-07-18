import type { UserRole, UserPermission } from '@/lib/roles';

export type MockAuthUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  initials: string;
};

export type MockAuthState = {
  user: MockAuthUser | null;
  loading: boolean;
  profileLoaded: boolean;
  firebaseUser: null;
  userRole: UserRole | null;
  userPermission: UserPermission | null;
  mainPage: string;
  visiblePages: string[];
  userTheme: string;
  barrio: string;
  organizacion: string;
  barrioOrg: string;
  isAppAdmin: boolean;
  refreshAuth: () => Promise<void>;
};

/** Leadership user with full access — default for page smoke tests. */
export function createMockAuthState(
  overrides: Partial<MockAuthState> = {},
): MockAuthState {
  return {
    user: {
      uid: 'test-user-1',
      email: 'test@sionflow.local',
      displayName: 'Test User',
      photoURL: null,
      initials: 'T',
    },
    loading: false,
    profileLoaded: true,
    firebaseUser: null,
    userRole: 'secretary',
    userPermission: 'all',
    mainPage: '/',
    visiblePages: [
      '/',
      '/members',
      '/observations',
      '/converts',
      '/ministering',
      '/birthdays',
      '/family-search',
      '/missionary-work',
      '/service',
      '/church-chat',
      '/council',
      '/reports/activities',
      '/settings',
      '/profile',
      '/donate',
      '/admin',
    ],
    userTheme: 'system',
    barrio: 'test-barrio',
    organizacion: 'test-org',
    barrioOrg: 'test-barrio|test-org',
    isAppAdmin: false,
    refreshAuth: async () => {},
    ...overrides,
  };
}
