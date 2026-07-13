
"use client";

import { useTheme } from "next-themes";
import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { usersCollection } from "@/lib/collections";
import { normalizeRole, normalizePermission, type UserRole, type UserPermission } from "@/lib/roles";

interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  initials: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** True once the Firestore user profile has been loaded (or confirmed missing). */
  profileLoaded: boolean;
  firebaseUser: FirebaseUser | null;
  userRole: UserRole | null;
  userPermission: UserPermission | null;
  mainPage: string;
  visiblePages: string[];
  userTheme: string;
  barrio: string;
  organizacion: string;
  barrioOrg: string;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const formatUser = (user: FirebaseUser): User => ({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    initials: user.displayName ? user.displayName.charAt(0).toUpperCase() : (user.email ? user.email.charAt(0).toUpperCase() : '?'),
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userPermission, setUserPermission] = useState<UserPermission | null>(null);
  const [mainPage, setMainPage] = useState<string>('/');
  const [visiblePages, setVisiblePages] = useState<string[]>([]);
  const [userTheme, setUserTheme] = useState<string>('system');
  const [barrio, setBarrio] = useState<string>('');
  const [organizacion, setOrganizacion] = useState<string>('');
  const [barrioOrg, setBarrioOrg] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const { setTheme } = useTheme();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(formatUser(currentUser));
        setFirebaseUser(currentUser);
        setProfileLoaded(false);
      } else {
        setUser(null);
        setFirebaseUser(null);
        setUserRole(null);
        setUserPermission(null);
        setMainPage('/');
        setVisiblePages([]);
        setBarrio('');
        setOrganizacion('');
        setBarrioOrg('');
        setProfileLoaded(true);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Live subscription so admin changes to role/permission/visiblePages apply immediately
  useEffect(() => {
    if (!firebaseUser) {
      return;
    }

    setProfileLoaded(false);
    const userDocRef = doc(usersCollection, firebaseUser.uid);

    const unsubscribe = onSnapshot(
      userDocRef,
      (userDoc) => {
        if (!userDoc.exists()) {
          setUserRole(normalizeRole(undefined));
          setUserPermission(normalizePermission(undefined));
          setVisiblePages([]);
          setProfileLoaded(true);
          return;
        }

        const data = userDoc.data();
        setUserRole(normalizeRole(data.role));
        setUserPermission(normalizePermission(data.permission));
        setMainPage(data.mainPage || '/');
        setVisiblePages(Array.isArray(data.visiblePages) ? data.visiblePages : []);

        const barrioVal = typeof data.barrio === "string" && data.barrio.trim().length > 0 ? data.barrio.trim() : "Libertad";
        const orgVal = typeof data.organizacion === "string" && data.organizacion.trim().length > 0 ? data.organizacion.trim() : "Quórum de Élderes";
        setBarrio(barrioVal);
        setOrganizacion(orgVal);
        setBarrioOrg(`${barrioVal}|${orgVal}`);

        // Sync photoURL from Firestore (may come from synced member)
        const firestorePhotoURL = typeof data.photoURL === "string" ? data.photoURL : null;
        setUser((prev) =>
          prev ? { ...prev, photoURL: firestorePhotoURL ?? prev.photoURL } : prev
        );

        // Load and sync theme from Firestore
        const savedTheme = data.theme;
        if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system')) {
          setUserTheme(savedTheme);
          setTheme(savedTheme);
        }

        setProfileLoaded(true);
      },
      () => {
        setUserRole(normalizeRole(undefined));
        setUserPermission(normalizePermission(undefined));
        setProfileLoaded(true);
      }
    );

    return () => unsubscribe();
  }, [firebaseUser, setTheme]);
  
  const refreshAuth = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      await currentUser.reload();
      const freshUser = auth.currentUser;
      if (freshUser) {
        // Auth profile fields only; role/permission stay live via onSnapshot
        setUser(formatUser(freshUser));
        setFirebaseUser(freshUser);
      }
    }
  }, []);

  const value = {
    user,
    loading,
    profileLoaded,
    firebaseUser,
    userRole,
    userPermission,
    mainPage,
    visiblePages,
    userTheme,
    barrio,
    organizacion,
    barrioOrg,
    refreshAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
