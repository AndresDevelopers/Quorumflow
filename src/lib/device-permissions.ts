import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDoc as safeGetDoc } from '@/lib/firestore-query';
import { devicePermissionsCollection, usersCollection } from '@/lib/collections';
import { getAppStoragePrefix } from '@/lib/app-config';

const DEVICE_PERMISSIONS_STORAGE_KEY = `${getAppStoragePrefix()}.perm.device-id`;

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `perm-device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getPermissionsDeviceId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const key = DEVICE_PERMISSIONS_STORAGE_KEY;
    let deviceId = window.localStorage.getItem(key);
    if (deviceId) return deviceId;

    deviceId = createDeviceId();
    window.localStorage.setItem(key, deviceId);
    return deviceId;
  } catch {
    return null;
  }
}

function getDocId(userId: string, deviceId: string): string {
  return `${userId}_${deviceId}`;
}

function getPermissionsRef(userId: string) {
  const deviceId = getPermissionsDeviceId();
  if (!deviceId) return null;
  return {
    deviceId,
    ref: doc(devicePermissionsCollection, getDocId(userId, deviceId)),
  };
}

export interface DevicePermissionRecord {
  userId: string;
  deviceId: string;
  gpsEnabled?: boolean;
  micEnabled?: boolean;
  updatedAt?: unknown;
}

/**
 * Load per-device GPS/Mic prefs for THIS device.
 * Falls back to account-level flags for existing users who haven't
 * toggled anything on this device yet (migration path).
 */
export async function getCurrentDevicePermissions(userId: string): Promise<{
  gpsEnabled: boolean;
  micEnabled: boolean;
  isExplicit: boolean; // true if this device has its own record
}> {
  const target = getPermissionsRef(userId);
  if (!target) {
    // No localStorage available — fall back to account level
    const userDoc = await safeGetDoc(doc(usersCollection, userId));
    const data = userDoc.exists() ? userDoc.data() : {};
    return {
      gpsEnabled: data.gpsPermissionEnabled === true,
      micEnabled: data.micPermissionEnabled === true,
      isExplicit: false,
    };
  }

  const snap = await safeGetDoc(target.ref);
  if (snap.exists()) {
    const data = snap.data() as DevicePermissionRecord;
    return {
      gpsEnabled: data.gpsEnabled === true,
      micEnabled: data.micEnabled === true,
      isExplicit: true,
    };
  }

  // No per-device record yet — read account-level as seed,
  // then save it so this device is independent from now on.
  const userSnap = await safeGetDoc(doc(usersCollection, userId));
  const userData = userSnap.exists() ? userSnap.data() : {};
  const seed = {
    gpsEnabled: userData.gpsPermissionEnabled === true,
    micEnabled: userData.micPermissionEnabled === true,
  };

  // Seed the per-device record silently so future toggles are independent
  await setDoc(
    target.ref,
    {
      userId,
      deviceId: target.deviceId,
      gpsEnabled: seed.gpsEnabled,
      micEnabled: seed.micEnabled,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return { ...seed, isExplicit: true };
}

/**
 * Guarda el permiso de GPS SOLO para este dispositivo.
 */
export async function saveCurrentDeviceGpsPermission(
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const target = getPermissionsRef(userId);
  if (!target) return false;

  await setDoc(
    target.ref,
    {
      userId,
      deviceId: target.deviceId,
      gpsEnabled: enabled,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}

/**
 * Guarda el permiso de micrófono SOLO para este dispositivo.
 */
export async function saveCurrentDeviceMicPermission(
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const target = getPermissionsRef(userId);
  if (!target) return false;

  await setDoc(
    target.ref,
    {
      userId,
      deviceId: target.deviceId,
      micEnabled: enabled,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}
