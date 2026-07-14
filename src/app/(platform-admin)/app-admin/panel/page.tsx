"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
  type User,
  type Unsubscribe,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { AppAdminListedUser } from "@/lib/app-admin";
import { getAppStoragePrefix } from "@/lib/app-config";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Users,
} from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  user: "Usuario",
  counselor: "Consejero",
  president: "Presidente",
  secretary: "Secretario",
  other: "Otro",
};

export default function AppAdminPanelPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [adminReady, setAdminReady] = useState(false);
  const [users, setUsers] = useState<AppAdminListedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [search, setSearch] = useState("");
  const [impersonatingUid, setImpersonatingUid] = useState<string | null>(null);

  /** Modal cambiar correo / contraseña de OTRO usuario */
  const [credsUser, setCredsUser] = useState<AppAdminListedUser | null>(null);
  const [credsEmail, setCredsEmail] = useState("");
  const [credsPassword, setCredsPassword] = useState("");
  const [credsPasswordConfirm, setCredsPasswordConfirm] = useState("");
  const [credsSaving, setCredsSaving] = useState(false);

  /** Modal configurar cuenta del SUPER ADMIN (propio) */
  const [selfAccountOpen, setSelfAccountOpen] = useState(false);
  const [selfEmail, setSelfEmail] = useState("");
  const [selfPassword, setSelfPassword] = useState("");
  const [selfPasswordConfirm, setSelfPasswordConfirm] = useState("");
  const [selfSaving, setSelfSaving] = useState(false);

  /** Evita que onAuthStateChanged haga signOut al cambiar a la sesión impersonada. */
  const impersonatingRef = useRef(false);
  const authUnsubRef = useRef<Unsubscribe | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q) ||
        u.barrio.toLowerCase().includes(q) ||
        u.organizacion.toLowerCase().includes(q)
    );
  }, [users, search]);

  const loadUsers = useCallback(
    async (user: User) => {
      if (impersonatingRef.current) return;
      setLoadingUsers(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/app-admin/users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401 || res.status === 403) {
          if (impersonatingRef.current) return;
          toast({
            title: "Sin permiso",
            description: "Esta sesión no es del admin general.",
            variant: "destructive",
          });
          await signOut(auth);
          router.replace("/app-admin/login");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || "Error al cargar usuarios");
        }
        const data = (await res.json()) as {
          users: AppAdminListedUser[];
        };
        setUsers(data.users ?? []);
      } catch (error) {
        if (impersonatingRef.current) return;
        toast({
          title: "Error",
          description:
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los usuarios.",
          variant: "destructive",
        });
      } finally {
        setLoadingUsers(false);
      }
    },
    [router, toast]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // Tras "Entrar como", el auth pasa al usuario objetivo: NO cerrar sesión.
      if (impersonatingRef.current) {
        return;
      }

      if (!user) {
        setFirebaseUser(null);
        setAdminReady(false);
        router.replace("/app-admin/login");
        return;
      }

      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/app-admin/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (impersonatingRef.current) return;
        if (!res.ok) {
          await signOut(auth);
          router.replace("/app-admin/login");
          return;
        }
        setFirebaseUser(user);
        setAdminReady(true);
        await loadUsers(user);
      } catch {
        if (impersonatingRef.current) return;
        router.replace("/app-admin/login");
      }
    });
    authUnsubRef.current = unsub;
    return () => {
      unsub();
      authUnsubRef.current = null;
    };
  }, [loadUsers, router]);

  const handleImpersonate = async (target: AppAdminListedUser) => {
    if (!firebaseUser || impersonatingRef.current) return;
    setImpersonatingUid(target.uid);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/app-admin/impersonate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetUid: target.uid }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        customToken?: string;
        target?: { uid: string; name: string | null; email: string | null };
      };
      if (!res.ok || !body.customToken) {
        throw new Error(body.error || "No se pudo impersonar");
      }

      // 1) Marcar y desuscribir ANTES del custom token, o el listener
      //    ve al usuario objetivo, falla /api/app-admin/me y hace signOut.
      impersonatingRef.current = true;
      authUnsubRef.current?.();
      authUnsubRef.current = null;

      // 2) Limpiar caché de sesión del admin para no mezclar perfiles
      try {
        const prefix = getAppStoragePrefix();
        localStorage.removeItem(`${prefix}_last_auth_uid`);
      } catch {
        // ignore
      }

      // 3) Entrar como el usuario real
      await signInWithCustomToken(auth, body.customToken);

      // 4) Navegación full-page: AuthProvider de (main) arranca limpio
      //    (rol "user" caerá en /no-permission por PrivateRoute; liderazgo en su mainPage)
      window.location.assign("/");
    } catch (error) {
      impersonatingRef.current = false;
      toast({
        title: "Impersonación fallida",
        description:
          error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
      setImpersonatingUid(null);
    }
  };

  const handleLogout = async () => {
    if (impersonatingRef.current) return;
    await signOut(auth);
    router.replace("/app-admin/login");
  };

  const openCredentialsDialog = (user: AppAdminListedUser) => {
    setCredsUser(user);
    setCredsEmail(user.email === "Sin correo" ? "" : user.email);
    setCredsPassword("");
    setCredsPasswordConfirm("");
  };

  const closeCredentialsDialog = () => {
    if (credsSaving) return;
    setCredsUser(null);
    setCredsEmail("");
    setCredsPassword("");
    setCredsPasswordConfirm("");
  };

  const handleSaveCredentials = async () => {
    if (!firebaseUser || !credsUser) return;

    const email = credsEmail.trim().toLowerCase();
    const password = credsPassword;
    const currentEmail =
      credsUser.email === "Sin correo" ? "" : credsUser.email.toLowerCase();

    const emailChanged = Boolean(email) && email !== currentEmail;
    const passwordChanged = password.length > 0;

    if (!emailChanged && !passwordChanged) {
      toast({
        title: "Sin cambios",
        description: "Escribe un correo nuevo y/o una contraseña nueva.",
        variant: "destructive",
      });
      return;
    }

    if (emailChanged) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) {
        toast({
          title: "Correo no válido",
          description: "Revisa el formato del correo.",
          variant: "destructive",
        });
        return;
      }
    }

    if (passwordChanged) {
      if (password.length < 6) {
        toast({
          title: "Contraseña corta",
          description: "Mínimo 6 caracteres (requisito de Firebase).",
          variant: "destructive",
        });
        return;
      }
      if (password !== credsPasswordConfirm) {
        toast({
          title: "No coinciden",
          description: "La contraseña y su confirmación deben ser iguales.",
          variant: "destructive",
        });
        return;
      }
    }

    setCredsSaving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/app-admin/update-credentials", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetUid: credsUser.uid,
          email: emailChanged ? email : "",
          password: passwordChanged ? password : "",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        email?: string;
        emailChanged?: boolean;
        passwordChanged?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error || "No se pudo actualizar");
      }

      const parts: string[] = [];
      if (body.emailChanged) parts.push("correo actualizado");
      if (body.passwordChanged) parts.push("contraseña actualizada");

      toast({
        title: "Credenciales guardadas",
        description:
          parts.length > 0
            ? `${credsUser.name}: ${parts.join(" y ")}.`
            : "Cambios aplicados.",
      });

      // Reflejar el nuevo correo en la tabla sin recargar todo
      if (body.emailChanged && body.email) {
        setUsers((prev) =>
          prev.map((u) =>
            u.uid === credsUser.uid ? { ...u, email: body.email! } : u
          )
        );
      }

      setCredsUser(null);
      setCredsEmail("");
      setCredsPassword("");
      setCredsPasswordConfirm("");
    } catch (error) {
      toast({
        title: "Error al guardar",
        description:
          error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setCredsSaving(false);
    }
  };

  const openSelfAccountDialog = () => {
    setSelfEmail(firebaseUser?.email ?? "");
    setSelfPassword("");
    setSelfPasswordConfirm("");
    setSelfAccountOpen(true);
  };

  const closeSelfAccountDialog = () => {
    if (selfSaving) return;
    setSelfAccountOpen(false);
    setSelfPassword("");
    setSelfPasswordConfirm("");
  };

  const handleSaveSelfAccount = async () => {
    if (!firebaseUser) return;

    const email = selfEmail.trim().toLowerCase();
    const password = selfPassword;
    const currentEmail = (firebaseUser.email ?? "").toLowerCase();

    const emailChanged = Boolean(email) && email !== currentEmail;
    const passwordChanged = password.length > 0;

    if (!emailChanged && !passwordChanged) {
      toast({
        title: "Sin cambios",
        description: "Escribe un correo nuevo y/o una contraseña nueva.",
        variant: "destructive",
      });
      return;
    }

    if (emailChanged) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) {
        toast({
          title: "Correo no válido",
          description: "Revisa el formato del correo.",
          variant: "destructive",
        });
        return;
      }
    }

    if (passwordChanged) {
      if (password.length < 6) {
        toast({
          title: "Contraseña corta",
          description: "Mínimo 6 caracteres (requisito de Firebase).",
          variant: "destructive",
        });
        return;
      }
      if (password !== selfPasswordConfirm) {
        toast({
          title: "No coinciden",
          description: "La contraseña y su confirmación deben ser iguales.",
          variant: "destructive",
        });
        return;
      }
    }

    setSelfSaving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/app-admin/update-self", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: emailChanged ? email : "",
          password: passwordChanged ? password : "",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        email?: string;
        emailChanged?: boolean;
        passwordChanged?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error || "No se pudo actualizar tu cuenta");
      }

      // Refrescar token/perfil local del cliente
      await firebaseUser.reload();
      const freshToken = await firebaseUser.getIdToken(true);
      void freshToken;

      const parts: string[] = [];
      if (body.emailChanged) parts.push("correo actualizado");
      if (body.passwordChanged) parts.push("contraseña actualizada");

      toast({
        title: "Tu cuenta fue actualizada",
        description:
          parts.length > 0
            ? `${parts.join(" y ")}. Usa estas credenciales en el próximo login.`
            : "Cambios aplicados.",
      });

      setSelfAccountOpen(false);
      setSelfPassword("");
      setSelfPasswordConfirm("");
      if (body.email) {
        setSelfEmail(body.email);
      }

      // Si cambió el correo o la contraseña, forzar re-login con las nuevas credenciales
      // para que la sesión del cliente quede alineada con Auth.
      if (body.emailChanged || body.passwordChanged) {
        await signOut(auth);
        router.replace("/app-admin/login");
      }
    } catch (error) {
      toast({
        title: "Error al guardar",
        description:
          error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setSelfSaving(false);
    }
  };

  if (!adminReady) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Shield className="h-6 w-6 text-rose-600" />
            Panel admin general
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Busca por nombre o correo, entra como ellos o cambia
            correo/contraseña.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!firebaseUser || selfSaving}
            onClick={openSelfAccountDialog}
          >
            <Settings className="h-4 w-4" />
            Mi cuenta
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loadingUsers || !firebaseUser}
            onClick={() => firebaseUser && loadUsers(firebaseUser)}
          >
            {loadingUsers ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              Usuarios registrados
            </CardDescription>
            <CardTitle className="text-3xl">
              {loadingUsers ? "…" : users.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Resultados del buscador</CardDescription>
            <CardTitle className="text-3xl">{filtered.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios</CardTitle>
          <CardDescription>
            El admin general no aparece en esta lista ni en Administración →
            Usuarios del barrio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nombre, correo, barrio…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loadingUsers ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {users.length === 0
                ? "No hay usuarios registrados todavía."
                : "Ningún usuario coincide con la búsqueda."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Correo</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Barrio / Org</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => (
                    <TableRow key={u.uid}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {u.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {ROLE_LABELS[u.role] ?? u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[u.barrio, u.organizacion].filter(Boolean).join(" · ") ||
                          "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              impersonatingUid !== null || credsSaving
                            }
                            onClick={() => openCredentialsDialog(u)}
                          >
                            <KeyRound className="h-4 w-4" />
                            Credenciales
                          </Button>
                          <Button
                            size="sm"
                            disabled={impersonatingUid !== null}
                            onClick={() => handleImpersonate(u)}
                          >
                            {impersonatingUid === u.uid ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <LogIn className="h-4 w-4" />
                            )}
                            Entrar como
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={credsUser !== null}
        onOpenChange={(open) => {
          if (!open) closeCredentialsDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Cambiar credenciales
            </DialogTitle>
            <DialogDescription>
              {credsUser
                ? `Usuario: ${credsUser.name} (${credsUser.email})`
                : "Editar correo y/o contraseña en Firebase Auth."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="creds-email">Correo electrónico</Label>
              <Input
                id="creds-email"
                type="email"
                autoComplete="off"
                placeholder="nuevo@correo.com"
                value={credsEmail}
                disabled={credsSaving}
                onChange={(e) => setCredsEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Déjalo igual si solo quieres cambiar la contraseña.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="creds-password">Nueva contraseña</Label>
              <Input
                id="creds-password"
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo 6 caracteres"
                value={credsPassword}
                disabled={credsSaving}
                onChange={(e) => setCredsPassword(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="creds-password-confirm">
                Confirmar contraseña
              </Label>
              <Input
                id="creds-password-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Repite la contraseña"
                value={credsPasswordConfirm}
                disabled={credsSaving}
                onChange={(e) => setCredsPasswordConfirm(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Vacío = no se cambia la contraseña. El usuario podrá entrar
                con el nuevo correo/clave en el login normal.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={credsSaving}
              onClick={closeCredentialsDialog}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={credsSaving}
              onClick={handleSaveCredentials}
            >
              {credsSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                "Guardar cambios"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Configurar cuenta del super admin */}
      <Dialog
        open={selfAccountOpen}
        onOpenChange={(open) => {
          if (!open) closeSelfAccountDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configurar mi cuenta
            </DialogTitle>
            <DialogDescription>
              Cambia el correo y/o la contraseña del admin general. Tras
              guardar se cerrará la sesión para que entres con las nuevas
              credenciales.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Sesión actual:{" "}
              <span className="font-mono text-foreground">
                {firebaseUser?.email ?? "—"}
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="self-email">Correo electrónico</Label>
              <Input
                id="self-email"
                type="email"
                autoComplete="username"
                placeholder="admin@sionflow.app"
                value={selfEmail}
                disabled={selfSaving}
                onChange={(e) => setSelfEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Déjalo igual si solo quieres cambiar la contraseña.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="self-password">Nueva contraseña</Label>
              <Input
                id="self-password"
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo 6 caracteres"
                value={selfPassword}
                disabled={selfSaving}
                onChange={(e) => setSelfPassword(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="self-password-confirm">
                Confirmar contraseña
              </Label>
              <Input
                id="self-password-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Repite la contraseña"
                value={selfPasswordConfirm}
                disabled={selfSaving}
                onChange={(e) => setSelfPasswordConfirm(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Vacío = no se cambia la contraseña.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={selfSaving}
              onClick={closeSelfAccountDialog}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={selfSaving}
              onClick={handleSaveSelfAccount}
            >
              {selfSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                "Guardar mi cuenta"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
