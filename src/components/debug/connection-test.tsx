'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { firestore } from '@/lib/firebase';
import { membersCollection } from '@/lib/collections';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/contexts/i18n-context';

/**
 * Componente de prueba específico para la conexión a Firestore
 * Identifica problemas de inicialización y permisos
 */
export function ConnectionTest() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  const addResult = (message: string) => {
    setResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const runConnectionTest = async () => {
    setTesting(true);
    setResults([]);

    try {
      addResult(t('debug.connection.log.start'));

      // Test 1: Check user authentication
      if (!user) {
        addResult(t('debug.connection.log.notAuth'));
        toast({
          title: t('debug.connection.toast.authErrorTitle'),
          description: t('debug.connection.toast.authErrorDescription'),
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }
      addResult(t('debug.connection.log.authOk', { email: user.email ?? '' }));

      // Test 2: Check Firestore initialization
      if (!firestore) {
        addResult(t('debug.connection.log.firestoreMissing'));
        toast({
          title: t('debug.connection.toast.firebaseErrorTitle'),
          description: t('debug.connection.toast.firebaseErrorDescription'),
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }
      addResult(t('debug.connection.log.firestoreOk'));

      // Test 3: Check members collection
      if (!membersCollection) {
        addResult(t('debug.connection.log.collectionMissing'));
        toast({
          title: t('debug.connection.toast.collectionErrorTitle'),
          description: t('debug.connection.toast.collectionErrorDescription'),
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }
      addResult(t('debug.connection.log.collectionOk'));

      // Test 4: Try to read from collection (test permissions)
      try {
        addResult(t('debug.connection.log.readTest'));
        const snapshot = await getDocs(membersCollection);
        addResult(t('debug.connection.log.readOk', { count: snapshot.size }));
      } catch (readError) {
        addResult(t('debug.connection.log.readError', {
          error: readError instanceof Error ? readError.message : t('reports.unknownError'),
        }));
        toast({
          title: t('debug.connection.toast.permissionErrorTitle'),
          description: t('debug.connection.toast.readPermissionDescription'),
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }

      // Test 5: Try to create a test document
      try {
        addResult(t('debug.connection.log.writeTest'));
        const testData = {
          firstName: 'Test',
          lastName: 'Connection',
          status: 'active' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: user.uid,
          lastActiveDate: new Date(),
        };

        const docRef = await addDoc(membersCollection, testData);
        addResult(t('debug.connection.log.writeOk', { id: docRef.id }));

        // Clean up: delete the test document
        try {
          await deleteDoc(doc(membersCollection, docRef.id));
          addResult(t('debug.connection.log.cleanupOk'));
        } catch (deleteError) {
          addResult(t('debug.connection.log.cleanupFail', {
            error: deleteError instanceof Error ? deleteError.message : t('reports.unknownError'),
          }));
        }

        toast({
          title: t('debug.connection.toast.successTitle'),
          description: t('debug.connection.toast.successDescription'),
        });

      } catch (writeError) {
        addResult(t('debug.connection.log.writeError', {
          error: writeError instanceof Error ? writeError.message : t('reports.unknownError'),
        }));
        
        // Analyze specific error types
        if (writeError instanceof Error) {
          if (writeError.message.includes('permission-denied')) {
            toast({
              title: t('debug.connection.toast.permissionErrorTitle'),
              description: t('debug.connection.toast.writePermissionDescription'),
              variant: 'destructive'
            });
          } else if (writeError.message.includes('unavailable')) {
            toast({
              title: t('debug.connection.toast.unavailableTitle'),
              description: t('debug.connection.toast.unavailableDescription'),
              variant: 'destructive'
            });
          } else {
            toast({
              title: t('debug.connection.toast.writeErrorTitle'),
              description: writeError.message,
              variant: 'destructive'
            });
          }
        }
      }

    } catch (generalError) {
      addResult(t('debug.connection.log.generalError', {
        error: generalError instanceof Error ? generalError.message : t('reports.unknownError'),
      }));
      toast({
        title: t('debug.connection.toast.generalErrorTitle'),
        description: t('debug.connection.toast.generalErrorDescription'),
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t('debug.connection.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          onClick={runConnectionTest} 
          disabled={testing}
          className="w-full"
        >
          {testing ? t('debug.connection.running') : t('debug.connection.run')}
        </Button>

        {results.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium">{t('debug.connection.results')}</h4>
            <div className="bg-gray-50 p-3 rounded-md max-h-60 overflow-y-auto">
              <pre className="text-xs whitespace-pre-wrap">
                {results.join('\n')}
              </pre>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          <p>{t('debug.connection.help1')}</p>
          <p>{t('debug.connection.help2')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
