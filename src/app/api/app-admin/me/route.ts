import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  AuthHttpError,
  getErrorStatus,
  requireAuth,
} from "@/lib/api-auth";
import { requireAppAdmin } from "@/lib/app-admin";
import logger from "@/lib/logger";

/**
 * GET /api/app-admin/me
 * Comprueba si el token actual pertenece al admin general.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "api");
  if (limited) return limited;

  try {
    const { uid } = await requireAuth(request);
    const admin = await requireAppAdmin(uid);
    return NextResponse.json({
      ok: true,
      uid: admin.uid,
      email: admin.email,
      name: admin.name,
    });
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (error instanceof AuthHttpError) {
      return NextResponse.json({ ok: false, error: error.message }, { status });
    }
    logger.error({ error, message: "[app-admin/me] unexpected error" });
    return NextResponse.json(
      { ok: false, error: "Error al verificar admin." },
      { status: 500 }
    );
  }
}
