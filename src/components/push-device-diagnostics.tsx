'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getIdToken } from 'firebase/auth';
import { AlertCircle, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { getBrowserPushDiagnostics } from '@/lib/firebase-messaging';
import type { BrowserPushDiagnostics, PushDiagnosticsResponse, PushSubscriptionDiagnostic } from '@/lib/push-diagnostics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/contexts/i18n-context';

function formatIsoDate(value: string | null, fallback: string, language: string): string {
  if (!value) {
    return fallback;
  }

  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-EC', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'America/Guayaquil',
  }).format(new Date(value));
}

function getResultVariant(result: PushSubscriptionDiagnostic['lastPushResult']) {
  if (result === 'success') {
    return 'default' as const;
  }

  if (result === 'failure' || result === 'invalid-token') {
    return 'destructive' as const;
  }

  return 'secondary' as const;
}

export function PushDeviceDiagnostics() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, language } = useI18n();
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserPushDiagnostics | null>(null);
  const [serverDiagnostics, setServerDiagnostics] = useState<PushDiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDryRunLoading, setIsDryRunLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async (runDryCheck = false) => {
    if (!user || !auth.currentUser) {
      return;
    }

    if (runDryCheck) {
      setIsDryRunLoading(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [browserState, idToken] = await Promise.all([
        getBrowserPushDiagnostics(),
        getIdToken(auth.currentUser, true),
      ]);

      const response = await fetch('/api/push/diagnostics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ runDryCheck }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.details ?? payload?.error ?? t('push.diagnostics.loadError'));
      }

      const payload = await response.json() as PushDiagnosticsResponse;
      setBrowserDiagnostics(browserState);
      setServerDiagnostics(payload);
      setError(null);

      if (runDryCheck) {
        toast({
          title: t('push.diagnostics.dryRunDoneTitle'),
          description: t('push.diagnostics.dryRunDoneDescription', {
            checked: payload.dryRunSummary?.tokensChecked ?? 0,
            success: payload.dryRunSummary?.successCount ?? 0,
          }),
        });
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : t('push.diagnostics.loadError');
      setError(message);
      toast({
        title: t('push.diagnostics.toastErrorTitle'),
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsDryRunLoading(false);
    }
  }, [toast, user, t]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void loadDiagnostics(false);
  }, [loadDiagnostics, user]);

  const currentDeviceSubscription = useMemo(() => {
    if (!serverDiagnostics || !browserDiagnostics?.deviceId) {
      return null;
    }

    return serverDiagnostics.subscriptions.find(
      (subscription) => subscription.deviceId === browserDiagnostics.deviceId
    ) ?? null;
  }, [browserDiagnostics?.deviceId, serverDiagnostics]);

  if (!user) {
    return null;
  }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              {t('push.diagnostics.title')}
            </CardTitle>
            <CardDescription>
              {t('push.diagnostics.description')}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadDiagnostics(false)}
              disabled={isLoading || isDryRunLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {t('push.diagnostics.refresh')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void loadDiagnostics(true)}
              disabled={isLoading || isDryRunLoading}
            >
              {isDryRunLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Dry-run
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.compatibility')}</div>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={browserDiagnostics?.isSupported ? 'default' : 'secondary'}>
                {browserDiagnostics?.isSupported ? t('push.diagnostics.compatible') : t('push.diagnostics.notCompatible')}
              </Badge>
              <Badge variant="outline">{browserDiagnostics?.permission ?? t('push.diagnostics.loading')}</Badge>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.serviceWorker')}</div>
            <div className="mt-2 font-medium">{browserDiagnostics?.serviceWorkerScriptUrl ?? t('push.diagnostics.notRegistered')}</div>
            <div className="text-xs text-muted-foreground">{browserDiagnostics?.serviceWorkerState ?? t('push.diagnostics.noState')}</div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.deviceId')}</div>
            <div className="mt-2 break-all font-mono text-xs">{browserDiagnostics?.deviceId ?? t('push.diagnostics.notAvailable')}</div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.userFlag')}</div>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={serverDiagnostics?.pushNotificationsEnabled ? 'default' : 'secondary'}>
                {serverDiagnostics?.pushNotificationsEnabled ? t('push.diagnostics.pushEnabled') : t('push.diagnostics.pushDisabled')}
              </Badge>
              <Badge variant={serverDiagnostics?.inAppNotificationsEnabled ? 'outline' : 'secondary'}>
                {serverDiagnostics?.inAppNotificationsEnabled ? t('push.diagnostics.inAppEnabled') : t('push.diagnostics.inAppDisabled')}
              </Badge>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.server')}</div>
            <div className="mt-2 text-sm">{serverDiagnostics?.serverTimeEcuador ?? t('push.diagnostics.noData')}</div>
            <div className="text-xs text-muted-foreground">{serverDiagnostics?.serverTimeUtc ?? ''}</div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Dry-run</div>
            <div className="mt-2 text-sm">
              {serverDiagnostics?.dryRunSummary
                ? t('push.diagnostics.tokensValid', {
                    success: serverDiagnostics.dryRunSummary.successCount,
                    checked: serverDiagnostics.dryRunSummary.tokensChecked,
                  })
                : t('push.diagnostics.notRunYet')}
            </div>
            <div className="text-xs text-muted-foreground">
              {serverDiagnostics?.dryRunSummary
                ? t('push.diagnostics.failures', { count: serverDiagnostics.dryRunSummary.failureCount })
                : t('push.diagnostics.dryRunHint')}
            </div>
          </div>
        </div>

        <div className="rounded-md border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{t('push.diagnostics.currentSubscription')}</div>
              <div className="text-xs text-muted-foreground">
                {t('push.diagnostics.currentSubscriptionHint')}
              </div>
            </div>
            <Badge variant={currentDeviceSubscription?.hasToken ? 'default' : 'secondary'}>
              {currentDeviceSubscription?.hasToken ? t('push.diagnostics.tokenPresent') : t('push.diagnostics.noToken')}
            </Badge>
          </div>

          {currentDeviceSubscription ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.document')}</div>
                <div className="mt-1 break-all font-mono text-xs">{currentDeviceSubscription.docId}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.updated')}</div>
                <div className="mt-1">{formatIsoDate(currentDeviceSubscription.updatedAt, t('push.diagnostics.noData'), language)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.subscribed')}</div>
                <div className="mt-1">{formatIsoDate(currentDeviceSubscription.subscribedAt, t('push.diagnostics.noData'), language)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.lastAttempt')}</div>
                <div className="mt-1">{formatIsoDate(currentDeviceSubscription.lastPushAttemptAt, t('push.diagnostics.noData'), language)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.result')}</div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={getResultVariant(currentDeviceSubscription.lastPushResult)}>
                    {currentDeviceSubscription.lastPushResult ?? t('push.diagnostics.noAttempts')}
                  </Badge>
                  {currentDeviceSubscription.lastPushAttemptMode && (
                    <Badge variant="outline">{currentDeviceSubscription.lastPushAttemptMode}</Badge>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.error')}</div>
                <div className="mt-1 break-all text-xs">
                  {currentDeviceSubscription.dryRunErrorCode ??
                    currentDeviceSubscription.lastPushErrorCode ??
                    t('push.diagnostics.noError')}
                </div>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('push.diagnostics.lastTag')}</div>
                <div className="mt-1 break-all text-xs">{currentDeviceSubscription.lastNotificationTag ?? t('push.diagnostics.noTag')}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('push.diagnostics.noSubscriptionDoc')}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
