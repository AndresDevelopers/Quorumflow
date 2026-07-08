'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Bell, BellRing, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getExistingNotificationToken,
  requestNotificationPermission,
} from '@/lib/firebase-messaging';
import {
  getCurrentPushSubscription,
  getCurrentPushSubscriptionTarget,
  saveCurrentPushSubscription,
} from '@/lib/push-subscription';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { usersCollection } from '@/lib/collections';
import { normalizeRole, leadershipRoles } from '@/lib/roles';
import logger from '@/lib/logger';

const DISMISSAL_COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000; // 15 días

export function PushOnboardingGuide() {
  const { user, firebaseUser, userRole } = useAuth();
  const { toast } = useToast();
  const [showGuide, setShowGuide] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Verificar si el navegador soporta notificaciones push
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    ) {
      setIsSupported(true);
    }
  }, []);

  const checkSubscription = useCallback(async () => {
    if (!user) return false;

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) return false;

    try {
      const subscriptionDoc = await getCurrentPushSubscription(user.uid);
      if (subscriptionDoc && subscriptionDoc.fcmToken) {
        return true;
      }

      const existingToken = await getExistingNotificationToken();
      return Boolean(existingToken);
    } catch {
      return false;
    }
  }, [user]);

  // Lógica principal: decidir si mostrar la guía
  useEffect(() => {
    let isMounted = true;

    const checkOnboardingStatus = async () => {
      if (!user || !firebaseUser || !isSupported) {
        if (isMounted) setIsChecking(false);
        return;
      }

      try {
        const userDocRef = doc(usersCollection, firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (!isMounted) return;

        if (!userDoc.exists()) {
          setIsChecking(false);
          return;
        }

        const data = userDoc.data();
        const role = normalizeRole(data.role);
        const pushEnabled = data.pushNotificationsEnabled === true;
        const dismissedAt = data.pushOnboardingDismissedAt;

        // Solo mostrar a roles de liderazgo sin push activado
        if (!leadershipRoles.includes(role as typeof leadershipRoles[number])) {
          setIsChecking(false);
          return;
        }

        // Ya tiene push activado → no mostrar
        if (pushEnabled) {
          setIsChecking(false);
          return;
        }

        // Verificar suscripción real del dispositivo
        const subscribed = await checkSubscription();
        if (isMounted) setIsSubscribed(subscribed);

        // Si ya tiene suscripción activa en este dispositivo, no mostrar
        if (subscribed) {
          setIsChecking(false);
          return;
        }

        // Si nunca ha descartado la guía → mostrar
        if (!dismissedAt) {
          if (isMounted) {
            setShowGuide(true);
            setIsChecking(false);
          }
          return;
        }

        // Si descartó hace más de 15 días → mostrar de nuevo
        const dismissedMs = dismissedAt.toMillis ? dismissedAt.toMillis() : 0;
        const now = Date.now();
        if (now - dismissedMs >= DISMISSAL_COOLDOWN_MS) {
          if (isMounted) {
            setShowGuide(true);
            setIsChecking(false);
          }
          return;
        }

        if (isMounted) setIsChecking(false);
      } catch (error) {
        logger.error({ error, message: 'Error checking push onboarding status' });
        if (isMounted) setIsChecking(false);
      }
    };

    checkOnboardingStatus();

    return () => {
      isMounted = false;
    };
  }, [user, firebaseUser, isSupported, userRole, checkSubscription]);

  const handleDismiss = async () => {
    if (!firebaseUser) return;

    try {
      const userDocRef = doc(usersCollection, firebaseUser.uid);
      await setDoc(userDocRef, {
        pushOnboardingDismissedAt: serverTimestamp(),
      }, { merge: true });

      setShowGuide(false);
    } catch (error) {
      logger.error({ error, message: 'Error dismissing push onboarding guide' });
      setShowGuide(false);
    }
  };

  const handleActivate = async () => {
    if (!user || !firebaseUser) {
      toast({
        title: 'Error',
        description: 'No se puede activar las notificaciones en este momento.',
        variant: 'destructive',
      });
      return;
    }

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) {
      toast({
        title: 'Error',
        description: 'No se pudo identificar este dispositivo.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const fcmToken = await requestNotificationPermission();
      if (!fcmToken) {
        toast({
          title: 'Permiso Denegado',
          description:
            'No se otorgó permiso para enviar notificaciones. Puedes activarlo más tarde desde Ajustes.',
          variant: 'destructive',
        });
        await handleDismiss();
        return;
      }

      await saveCurrentPushSubscription(user.uid, fcmToken);

      // Sincronizar pushNotificationsEnabled en c_users
      const userDocRef = doc(usersCollection, firebaseUser.uid);
      await setDoc(userDocRef, {
        pushNotificationsEnabled: true,
        pushOnboardingDismissedAt: serverTimestamp(),
      }, { merge: true });

      setIsSubscribed(true);
      setShowGuide(false);

      toast({
        title: 'Notificaciones Activadas',
        description:
          'A partir de ahora recibirás novedades importantes de tu organización en tu celular.',
      });

      // Notificación de bienvenida
      if (Notification.permission === 'granted') {
        new Notification('¡Notificaciones activadas!', {
          body: 'Ahora recibirás recordatorios y novedades importantes de tu organización.',
          icon: '/icono-app.png',
          badge: '/icono-app.png',
        });
      }
    } catch (error) {
      logger.error({ error, message: 'Error activating push from onboarding guide' });
      toast({
        title: 'Error',
        description: 'No se pudo activar las notificaciones. Intenta de nuevo desde Ajustes.',
        variant: 'destructive',
      });
      await handleDismiss();
    } finally {
      setIsLoading(false);
    }
  };

  // No mostrar nada mientras se verifica o si no aplica
  if (isChecking || !showGuide || !isSupported || !user) {
    return null;
  }

  return (
    <AlertDialog open={showGuide} onOpenChange={(open) => {
      if (!open) handleDismiss();
    }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader className="space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <BellRing className="h-7 w-7 text-primary" />
          </div>
          <AlertDialogTitle className="text-center text-lg">
            Mantente al tanto de tu organización
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center space-y-3">
            <p>
              Como parte del liderazgo, es importante que recibas las novedades
              de tu organización al instante. Activa las notificaciones push en
              tu celular para no perderte:
            </p>
            <ul className="text-left list-disc list-inside space-y-1 text-sm">
              <li>Cumpleaños de miembros</li>
              <li>Familias que necesitan atención urgente</li>
              <li>Actividades y servicios próximos</li>
              <li>Asignaciones de la obra misional</li>
              <li>Recordatorios del consejo</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Puedes omitir este paso y configurarlo más tarde desde Ajustes.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction
            onClick={handleActivate}
            disabled={isLoading}
            className="w-full"
          >
            <Bell className="mr-2 h-4 w-4" />
            {isLoading ? 'Activando...' : 'Activar notificaciones'}
          </AlertDialogAction>
          <AlertDialogCancel
            onClick={handleDismiss}
            disabled={isLoading}
            className="w-full"
          >
            <X className="mr-2 h-4 w-4" />
            Omitir por ahora
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
