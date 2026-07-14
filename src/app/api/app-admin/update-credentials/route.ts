import { NextResponse } from "next/server";
import { z } from "zod";
import { authAdmin, firestoreAdmin } from "@/lib/firebase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  AuthHttpError,
  getErrorStatus,
  requireAuth,
} from "@/lib/api-auth";
import { isAppAdminDoc, requireAppAdmin } from "@/lib/app-admin";
import logger from "@/lib/logger";

const bodySchema = z
  .object({
    targetUid: z.string().min(1).max(128),
    /** Vacío o omitido = no cambiar correo */
    email: z.string().trim().max(320).optional().default(""),
    /** Vacío o omitido = no cambiar contraseña */
    password: z.string().max(128).optional().default(""),
  })
  .superRefine((data, ctx) => {
    const email = data.email.trim();
    const password = data.password;
    if (!email && !password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Indica un correo nuevo y/o una contraseña nueva.",
        path: ["email"],
      });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Correo no válido",
        path: ["email"],
      });
    }
    if (password && password.length < 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La contraseña debe tener al menos 6 caracteres",
        path: ["password"],
      });
    }
  });

/**
 * POST /api/app-admin/update-credentials
 * Cambia email y/o password de un usuario (Firebase Auth + c_users.email).
 * Solo admin general. No se puede modificar a otro app admin.
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
      const first =
        parsed.error.issues[0]?.message ?? "Payload inválido";
      return NextResponse.json(
        { error: first, details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { targetUid } = parsed.data;
    const newEmail = parsed.data.email?.trim().toLowerCase() ?? "";
    const newPassword = parsed.data.password ?? "";

    if (targetUid === actorUid) {
      return NextResponse.json(
        {
          error:
            "No uses este panel para tu propia cuenta de admin general. Usa bootstrap o Firebase Console.",
        },
        { status: 400 }
      );
    }

    const targetSnap = await firestoreAdmin
      .collection("c_users")
      .doc(targetUid)
      .get();

    if (targetSnap.exists && isAppAdminDoc(targetSnap.data())) {
      return NextResponse.json(
        { error: "No se puede modificar al admin general." },
        { status: 403 }
      );
    }

    let authUser;
    try {
      authUser = await authAdmin.getUser(targetUid);
    } catch {
      return NextResponse.json(
        { error: "Usuario no encontrado en Firebase Auth." },
        { status: 404 }
      );
    }

    const previousEmail = authUser.email ?? null;
    const updates: { email?: string; password?: string; emailVerified?: boolean } =
      {};

    if (newEmail && newEmail !== (previousEmail ?? "").toLowerCase()) {
      // Comprobar que el correo no esté en uso
      try {
        const existing = await authAdmin.getUserByEmail(newEmail);
        if (existing.uid !== targetUid) {
          return NextResponse.json(
            { error: "Ese correo ya está en uso por otra cuenta." },
            { status: 409 }
          );
        }
      } catch (err: unknown) {
        const code =
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          typeof (err as { code: unknown }).code === "string"
            ? (err as { code: string }).code
            : "";
        if (code !== "auth/user-not-found") {
          throw err;
        }
        // libre: ok
      }
      updates.email = newEmail;
      updates.emailVerified = true;
    }

    if (newPassword.length > 0) {
      updates.password = newPassword;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No hay cambios que aplicar." },
        { status: 400 }
      );
    }

    await authAdmin.updateUser(targetUid, updates);

    // Sincronizar email en c_users si cambió
    if (updates.email) {
      await firestoreAdmin
        .collection("c_users")
        .doc(targetUid)
        .set(
          {
            email: updates.email,
            updatedAt: new Date(),
          },
          { merge: true }
        );
    }

    try {
      await firestoreAdmin.collection("c_admin_audit").add({
        action: "user.credentials_updated",
        actorUid,
        actorName: actor.name ?? actor.email ?? "app-admin",
        targetId: targetUid,
        targetName:
          (typeof targetSnap.data()?.name === "string"
            ? targetSnap.data()?.name
            : null) ??
          updates.email ??
          previousEmail ??
          targetUid,
        details: {
          emailChanged: Boolean(updates.email),
          passwordChanged: Boolean(updates.password),
          previousEmail,
          newEmail: updates.email ?? previousEmail,
          source: "app-admin-panel",
        },
        barrioOrg:
          typeof targetSnap.data()?.barrioOrg === "string"
            ? targetSnap.data()?.barrioOrg
            : "__system__|credentials",
        createdAt: new Date(),
      });
    } catch (auditError) {
      logger.warn({
        error: auditError,
        message: "[app-admin/update-credentials] audit write failed",
      });
    }

    logger.info({
      message: "[app-admin/update-credentials] updated",
      actorUid,
      targetUid,
      emailChanged: Boolean(updates.email),
      passwordChanged: Boolean(updates.password),
    });

    return NextResponse.json({
      ok: true,
      uid: targetUid,
      email: updates.email ?? previousEmail,
      emailChanged: Boolean(updates.email),
      passwordChanged: Boolean(updates.password),
    });
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (error instanceof AuthHttpError) {
      return NextResponse.json({ error: error.message }, { status });
    }

    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "";

    if (code === "auth/email-already-exists") {
      return NextResponse.json(
        { error: "Ese correo ya está en uso por otra cuenta." },
        { status: 409 }
      );
    }
    if (code === "auth/invalid-email") {
      return NextResponse.json(
        { error: "Correo no válido." },
        { status: 400 }
      );
    }
    if (code === "auth/invalid-password") {
      return NextResponse.json(
        { error: "La contraseña no cumple los requisitos de Firebase." },
        { status: 400 }
      );
    }

    logger.error({
      error,
      message: "[app-admin/update-credentials] unexpected error",
    });
    return NextResponse.json(
      { error: "No se pudieron actualizar las credenciales." },
      { status: 500 }
    );
  }
}
