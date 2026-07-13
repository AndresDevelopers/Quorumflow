
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc } from 'firebase/firestore';
import { getDoc } from '@/lib/firestore-query';
import { futureMembersCollection } from '@/lib/collections';
import type { FutureMember } from '@/lib/types';
import { FutureMemberForm } from '../../FutureMemberForm';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function EditFutureMemberPage() {
  const params = useParams();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const { id } = params;
  const [futureMember, setFutureMember] = useState<FutureMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const futureMemberId = Array.isArray(id) ? id[0] : id;

  useEffect(() => {
    if (!futureMemberId || !user) return;

    const fetchFutureMember = async () => {
      setLoading(true);
      try {
        const docRef = doc(futureMembersCollection, futureMemberId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setFutureMember({ id: docSnap.id, ...docSnap.data() } as FutureMember);
        } else {
          setError('Futuro miembro no encontrado.');
        }
      } catch (err) {
        setError('Error al cargar los datos.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchFutureMember();
  }, [futureMemberId, user]);

  if (loading || authLoading) {
    return (
        <Dialog open={true}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="sr-only">{t('common.loadingShort')}</DialogTitle>
                </DialogHeader>
                <div className="max-w-2xl mx-auto space-y-4">
                    <Skeleton className="h-10 w-1/3" />
                    <Skeleton className="h-8 w-1/2" />
                    <div className="space-y-6 p-6 border rounded-lg">
                        <Skeleton className="h-24 w-24 rounded-full mx-auto" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <div className="flex justify-end gap-2">
                            <Skeleton className="h-10 w-24" />
                            <Skeleton className="h-10 w-24" />
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
  }

  if (error) {
    return <div className="text-center text-destructive">{error}</div>;
  }

  return futureMember ? <FutureMemberForm futureMember={futureMember} /> : null;
}
