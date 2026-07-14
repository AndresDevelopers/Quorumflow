import { NextResponse } from "next/server";
import { z } from "zod";
import { authAdmin, firestoreAdmin } from "@/lib/firebase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  AuthHttpError,
  getErrorStatus,
  requireAuth,
} from "@/lib/api-auth";
import {
  isAppAdminDoc,
  requireAppAdmin,
} from "@/lib/app-admin";
import logger from "@/lib/logger";

const bodySchema = z.object({
  targetUid: z.string().min(1).max(128),
});

/**
 * POST /api/app-admin/impersonate
 * Genera un custom token de Firebase para iniciar sesión como otro usuario.
 * Solo el admin general. No se puede impersonar a otro app admin.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth");
  if (limited) return limited;

  try {
    const { uid: actorUid } = await requireAuth(request);
    const actor = await requireAppAdmin(actorUid);

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { targetUid } = parsed.data;

    if (targetUid === actorUid) {
      return NextResponse.json(
        { error: "Ya eres este usuario." },
        { status: 400 }
      );
    }

    const targetSnap = await firestoreAdmin
      .collection("c_users")
      .doc(targetUid)
      .get();

    if (!targetSnap.exists) {
      // También permitir impersonar si el uid existe en Auth aunque falte perfil
      try {
        await authAdmin.getUser(targetUid);
      } catch {
        return NextResponse.json(
          { error: "Usuario objetivo no encontrado." },
          { status: 404 }
        );
      }
    } else if (isAppAdminDoc(targetSnap.data())) {
      return NextResponse.json(
        { error: "No se puede impersonar al admin general." },
        { status: 403 }
      );
    }

    const targetData = targetSnap.exists ? targetSnap.data() : undefined;
    const targetEmail =
      typeof targetData?.email === "string"
        ? targetData.email
        : (await authAdmin.getUser(targetUid).catch(() => null))?.email ?? null;
    const targetName =
      typeof targetData?.name === "string" ? targetData.name : null;

    const customToken = await authAdmin.createCustomToken(targetUid, {
      impersonatedBy: actorUid,
      impersonation: true,
    });

    // Auditoría server-side (Admin SDK; no depende de rules del cliente)
    try {
      await firestoreAdmin.collection("c_admin_audit").add({
        action: "user.impersonated",
        actorUid,
        actorName: actor.name ?? actor.email ?? "app-admin",
        targetId: targetUid,
        targetName: targetName ?? targetEmail ?? targetUid,
        details: {
          targetEmail,
          source: "app-admin-panel",
        },
        barrioOrg:
          typeof targetData?.barrioOrg === "string"
            ? targetData.barrioOrg
            : "__system__|impersonation",
        createdAt: new Date(),
      });
    } catch (auditError) {
      logger.warn({
        error: auditError,
        message: "[app-admin/impersonate] audit write failed",
      });
    }

    logger.info({
      message: "[app-admin/impersonate] custom token issued",
      actorUid,
      targetUid,
    });

    return NextResponse.json({
      customToken,
      target: {
        uid: targetUid,
        name: targetName,
        email: targetEmail,
      },
    });
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (error instanceof AuthHttpError) {
      return NextResponse.json({ error: error.message }, { status });
    }
    logger.error({ error, message: "[app-admin/impersonate] unexpected error" });
    return NextResponse.json(
      { error: "No se pudo iniciar sesión como ese usuario." },
      { status: 500 }
    );
  }
}
