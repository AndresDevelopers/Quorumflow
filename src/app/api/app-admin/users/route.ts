import { NextResponse } from "next/server";
import { firestoreAdmin } from "@/lib/firebase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  AuthHttpError,
  getErrorStatus,
  requireAuth,
} from "@/lib/api-auth";
import {
  isAppAdminDoc,
  requireAppAdmin,
  type AppAdminListedUser,
} from "@/lib/app-admin";
import { normalizePermission, normalizeRole } from "@/lib/roles";
import logger from "@/lib/logger";

/**
 * GET /api/app-admin/users
 * Lista TODOS los usuarios registrados (c_users), excluyendo al admin general.
 * Solo el admin general (isAppAdmin) puede llamar este endpoint.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "api");
  if (limited) return limited;

  try {
    const { uid } = await requireAuth(request);
    await requireAppAdmin(uid);

    const snap = await firestoreAdmin.collection("c_users").get();
    const users: AppAdminListedUser[] = [];

    snap.forEach((doc) => {
      const data = doc.data();
      if (isAppAdminDoc(data)) return;

      const createdAt = data.createdAt?.toDate?.()
        ? (data.createdAt.toDate() as Date).toISOString()
        : null;

      users.push({
        uid: doc.id,
        name: typeof data.name === "string" && data.name.trim()
          ? data.name.trim()
          : "Sin nombre",
        email: typeof data.email === "string" && data.email.trim()
          ? data.email.trim()
          : "Sin correo",
        role: normalizeRole(data.role),
        permission: normalizePermission(data.permission),
        barrio: typeof data.barrio === "string" ? data.barrio : "",
        organizacion:
          typeof data.organizacion === "string" ? data.organizacion : "",
        barrioOrg: typeof data.barrioOrg === "string" ? data.barrioOrg : "",
        createdAt,
      });
    });

    users.sort((a, b) => {
      const aT = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bT = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bT - aT;
    });

    return NextResponse.json({ users, total: users.length });
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (error instanceof AuthHttpError) {
      return NextResponse.json({ error: error.message }, { status });
    }
    logger.error({ error, message: "[app-admin/users] unexpected error" });
    return NextResponse.json(
      { error: "No se pudieron cargar los usuarios." },
      { status: 500 }
    );
  }
}
