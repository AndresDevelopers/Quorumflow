/**
 * Admin general de la app (platform admin).
 * No es el liderazgo de barrio (secretary/president en /admin).
 * Se identifica con `isAppAdmin: true` en c_users y no aparece en admin → users.
 */

import { firestoreAdmin } from "@/lib/firebase-admin";
import { AuthHttpError } from "@/lib/api-auth";

/** Tenant sintético: no coincide con barrios reales. */
export const APP_ADMIN_BARRIO_ORG = "__system__|__app_admin__";

export const APP_ADMIN_FIELD = "isAppAdmin" as const;

export type AppAdminUserDoc = {
  isAppAdmin?: boolean;
  email?: string;
  name?: string;
  role?: string;
  permission?: string;
  barrioOrg?: string;
  barrio?: string;
  organizacion?: string;
};

/** Email canónico del admin general (env). */
export function getAppAdminEmail(): string {
  return (process.env.APP_ADMIN_EMAIL || "admin@sionflow.app").trim().toLowerCase();
}

export function isAppAdminDoc(
  data: FirebaseFirestore.DocumentData | AppAdminUserDoc | undefined | null
): boolean {
  if (!data) return false;
  if (data.isAppAdmin === true) return true;
  const email =
    typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (email && email === getAppAdminEmail()) return true;
  return false;
}

/**
 * Verifica que el uid autenticado es el admin general de la app.
 * Solo acepta isAppAdmin === true en c_users (escrito por Admin SDK / bootstrap).
 * No basta con tener el mismo email que APP_ADMIN_EMAIL.
 * Lanza AuthHttpError 403 si no lo es.
 */
export async function requireAppAdmin(uid: string): Promise<{
  uid: string;
  email: string | null;
  name: string | null;
}> {
  const snap = await firestoreAdmin.collection("c_users").doc(uid).get();
  if (!snap.exists) {
    throw new AuthHttpError("Perfil de admin no encontrado.", 403);
  }
  const data = snap.data() as AppAdminUserDoc;
  // Estricto: flag de servidor, no solo coincidencia de email
  if (data.isAppAdmin !== true) {
    throw new AuthHttpError(
      "Acceso denegado. Solo el admin general de la app puede usar este recurso.",
      403
    );
  }
  return {
    uid,
    email: typeof data.email === "string" ? data.email : null,
    name: typeof data.name === "string" ? data.name : null,
  };
}

/** Payload de listado para el panel. */
export type AppAdminListedUser = {
  uid: string;
  name: string;
  email: string;
  role: string;
  permission: string;
  barrio: string;
  organizacion: string;
  barrioOrg: string;
  createdAt: string | null;
};
