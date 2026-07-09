// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { firebaseConfig } from "@/firebaseConfig"; // Import config from the new file

const isBrowser = typeof window !== "undefined";

let app: ReturnType<typeof getApp> | undefined;
if (isBrowser) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig as never) : getApp();
}

function createFirestore() {
  if (!app) {
    return undefined as unknown as ReturnType<typeof getFirestore>;
  }
  try {
    // Persistent multi-tab cache: fewer network re-reads on navigation/reload
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // Already initialized (HMR / double import) — reuse existing instance
    return getFirestore(app);
  }
}

// Export client SDK instances
export const auth = app ? getAuth(app) : (undefined as unknown as ReturnType<typeof getAuth>);
export const firestore = isBrowser ? createFirestore() : (undefined as unknown as ReturnType<typeof getFirestore>);
export const storage = app ? getStorage(app) : (undefined as unknown as ReturnType<typeof getStorage>);
export const functions = app ? getFunctions(app) : (undefined as unknown as ReturnType<typeof getFunctions>);

export { app };
