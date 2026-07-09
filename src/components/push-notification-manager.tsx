'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Bell, BellOff } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteNotificationToken,
  getExistingNotificationToken,
  requestNotificationPermission,
} from '@/lib/firebase-messaging';
import {
  clearCurrentPushSubscription,
  getCurrentPushSubscription,
  getCurrentPushSubscriptionTarget,
  saveCurrentPushSubscription,
} from '@/lib/push-subscription';
import { doc, setDoc } from 'firebase/firestore';
import { usersCollection } from '@/lib/collections';
import { useI18n } from '@/contexts/i18n-context';

export function PushNotificationManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const checkSubscription = useCallback(async () => {
    if (!user) {
      setIsSubscribed(false);
      return;
    }

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) {
      setIsSubscribed(false);
      return;
    }

    try {
      const subscriptionDoc = await getCurrentPushSubscription(user.uid);
      if (subscriptionDoc) {
        setIsSubscribed(Boolean(subscriptionDoc.fcmToken));
        return;
      }

      const existingToken = await getExistingNotificationToken();
      setIsSubscribed(Boolean(existingToken));
    } catch (error) {
      console.error('Error checking push subscription:', error);
      setIsSubscribed(false);
    }
  }, [user]);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    ) {
      setIsSupported(true);
      void checkSubscription();
    }
  }, [checkSubscription]);

  const subscribeToPush = async () => {
    if (!user) {
      toast({
        title: t('common.error'),
        description: t('push.manager.toast.cannotEnable'),
        variant: "destructive"
      });
      return;
    }

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) {
      toast({
        title: t('common.error'),
        description: t('push.manager.toast.deviceIdError'),
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      const fcmToken = await requestNotificationPermission();
      if (!fcmToken) {
        toast({
          title: t('push.manager.toast.permissionDeniedTitle'),
          description: t('push.manager.toast.permissionDeniedDescription'),
          variant: "destructive"
        });
        return;
      }

      await saveCurrentPushSubscription(user.uid, fcmToken);

      // Sincronizar pushNotificationsEnabled en c_users para que las Cloud Functions
      // puedan determinar la elegibilidad de push del usuario.
      const userDocRef = doc(usersCollection, user.uid);
      await setDoc(userDocRef, {
        pushNotificationsEnabled: true
      }, { merge: true });

      setIsSubscribed(true);
      toast({
        title: t('push.manager.toast.enabledTitle'),
        description: t('push.manager.toast.enabledDescription'),
      });

      if (Notification.permission === 'granted') {
        new Notification(t('push.manager.nativeTitle'), {
          body: t('push.manager.nativeBody'),
          icon: '/icono-app.png',
          badge: '/icono-app.png'
        });
      }
    } catch (error) {
      console.error('Error subscribing to push:', error);
      toast({
        title: t('common.error'),
        description: t('push.manager.toast.activateError'),
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
      setShowPermissionDialog(false);
    }
  };

  const unsubscribeFromPush = async () => {
    if (!user) {
      return;
    }

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) {
      return;
    }

    setIsLoading(true);
    try {
      await deleteNotificationToken();

      await clearCurrentPushSubscription(user.uid);

      // Desactivar pushNotificationsEnabled en c_users
      const userDocRef = doc(usersCollection, user.uid);
      await setDoc(userDocRef, {
        pushNotificationsEnabled: false
      }, { merge: true });

      setIsSubscribed(false);
      toast({
        title: t('push.manager.toast.disabledTitle'),
        description: t('push.manager.toast.disabledDescription'),
      });
    } catch (error) {
      console.error('Error unsubscribing from push:', error);
      toast({
        title: t('common.error'),
        description: t('push.manager.toast.deactivateError'),
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isSupported || !user) {
    return null;
  }

  return (
    <>
      <Button
        variant={isSubscribed ? "outline" : "default"}
        size="sm"
        onClick={() => {
          if (isSubscribed) {
            void unsubscribeFromPush();
          } else {
            setShowPermissionDialog(true);
          }
        }}
        disabled={isLoading}
      >
        {isSubscribed ? (
          <>
            <BellOff className="mr-2 h-4 w-4" />
            {t('push.manager.disable')}
          </>
        ) : (
          <>
            <Bell className="mr-2 h-4 w-4" />
            {t('push.manager.enable')}
          </>
        )}
      </Button>

      <AlertDialog open={showPermissionDialog} onOpenChange={setShowPermissionDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('push.manager.dialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('push.manager.dialogDescription')}
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>{t('push.manager.item.birthdays')}</li>
                <li>{t('push.manager.item.services')}</li>
                <li>{t('push.manager.item.ministering')}</li>
                <li>{t('push.manager.item.activities')}</li>
                <li>{t('push.manager.item.missionary')}</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={subscribeToPush}>
              {t('push.manager.activate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
