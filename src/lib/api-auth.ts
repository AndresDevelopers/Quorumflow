/**
 * Shared API auth helpers for Next.js route handlers.
 * Pattern mirrors requireUid in /api/storage/upload (Bearer + verifyIdToken).
 */
import { authAdmin, firestoreAdmin } from '@/lib/firebase-admin';
import logger from '@/lib/logger';

export class AuthHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthHttpError';
    this.status = status;
  }
}

/**
 * Extract Bearer token, verify with Firebase Admin, return uid.
 * Throws AuthHttpError with status 401 on missing/invalid token.
 */
export async function requireUid(request: Request): Promise<string> {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new AuthHttpError('No autenticado. Inicia sesión de nuevo.', 401);
  }
  try {
    const decoded = await authAdmin.verifyIdToken(match[1]);
    return decoded.uid;
  } catch (error) {
    logger.warn({ error, message: 'Invalid ID token on API request' });
    throw new AuthHttpError('Token inválido o expirado. Cierra sesión y vuelve a entrar.', 401);
  }
}

/**
 * Resolve barrioOrg from c_users/{uid} as "barrio|organizacion".
 * Same construction as getAllUsersNotificationData() in Cloud Functions.
 * Throws AuthHttpError 403 if the user document does not exist.
 */
export async function getUserBarrioOrg(uid: string): Promise<string> {
  const userDoc = await firestoreAdmin.collection('c_users').doc(uid).get();
  if (!userDoc.exists) {
    throw new AuthHttpError('Usuario no encontrado.', 403);
  }
  const data = userDoc.data()!;
  const barrio = (data.barrio as string) || 'Libertad';
  const organizacion = (data.organizacion as string) || 'Quórum de Élderes';
  return `${barrio}|${organizacion}`;
}

/** requireUid + getUserBarrioOrg in one call. */
export async function requireUidAndBarrioOrg(
  request: Request
): Promise<{ uid: string; barrioOrg: string }> {
  const uid = await requireUid(request);
  const barrioOrg = await getUserBarrioOrg(uid);
  return { uid, barrioOrg };
}

export function getErrorStatus(error: unknown, fallback = 500): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return fallback;
}
