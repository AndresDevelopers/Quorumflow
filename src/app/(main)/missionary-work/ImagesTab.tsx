'use client';

/**
 * Images tab for missionary work.
 * Lives in its own module so browsers pick up a NEW chunk path after the
 * previous page.js was cached as immutable / served by an old service worker.
 */
import { useState, useTransition } from 'react';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Trash2 } from 'lucide-react';
import {
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { compressGalleryImage, compressImageForUpload } from '@/lib/image-compression';
import { missionaryImagesCollection, storage } from '@/lib/collections';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import type { MissionaryImage } from '@/lib/types';

async function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen para la IA'));
    reader.readAsDataURL(blob);
  });
}

/** Direct HTTP call — never a Next.js Server Action. */
async function describeImageViaApi(imageDataUrl: string): Promise<string> {
  const response = await fetch('/api/analyze-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ imageData: imageDataUrl }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    description?: string;
    error?: string;
  };
  if (!response.ok || !payload.description) {
    throw new Error(payload.error || `analyze-image failed (${response.status})`);
  }
  return payload.description;
}

export function ImagesTab({
  images,
  loading,
  onRefresh,
  barrioOrg,
}: {
  images: MissionaryImage[];
  loading: boolean;
  onRefresh: () => void;
  barrioOrg: string;
}) {
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();
  const [isPending, startTransition] = useTransition();
  const [uploadedFiles, setUploadedFiles] = useState<
    {
      id: string;
      file: File;
      previewUrl: string;
      url: string | null;
      description: string;
      status: 'uploading' | 'processing' | 'ready';
      progress: number;
    }[]
  >([]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    event.target.value = '';

    if (!storage) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.uploadError'),
        variant: 'destructive',
      });
      return;
    }

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.name}`;
      const previewUrl = URL.createObjectURL(file);
      setUploadedFiles((prev) => [
        ...prev,
        {
          id,
          file,
          previewUrl,
          url: null,
          description: '',
          status: 'uploading',
          progress: 10,
        },
      ]);

      try {
        const optimized = await compressGalleryImage(file);
        setUploadedFiles((prev) =>
          prev.map((item) => (item.id === id ? { ...item, progress: 35 } : item))
        );

        const forAi = await compressImageForUpload(optimized, {
          maxDimension: 1024,
          quality: 0.72,
          maxBytes: 350 * 1024,
          preferWebp: false,
        });

        const storageRef = ref(storage, `missionary-images/${id}`);
        setUploadedFiles((prev) =>
          prev.map((item) => (item.id === id ? { ...item, progress: 55 } : item))
        );

        const snapshot = await uploadBytes(storageRef, optimized, {
          contentType: optimized.type || 'image/jpeg',
        });
        const downloadURL = await getDownloadURL(snapshot.ref);

        setUploadedFiles((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, url: downloadURL, status: 'processing', progress: 100 }
              : item
          )
        );

        try {
          const base64 = await fileToDataUrl(forAi);
          const description = await describeImageViaApi(base64);
          setUploadedFiles((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, description, status: 'ready' } : item
            )
          );
        } catch (error: unknown) {
          console.error('[ImagesTab] /api/analyze-image failed:', error);
          const msg = String((error as { message?: string })?.message ?? error ?? '');
          const missingKey =
            msg.includes('API key') ||
            msg.includes('GEMINI_API_KEY') ||
            msg.includes('GOOGLE_GENERATIVE_AI_API_KEY');
          toast({
            title: t('common.error'),
            description: missingKey
              ? t('missionaryWork.images.apiKeyMissing')
              : t('missionaryWork.images.autoDescError'),
            variant: 'destructive',
          });
          setUploadedFiles((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, description: '', status: 'ready' } : item
            )
          );
        }
      } catch (error) {
        console.error('[ImagesTab] upload error:', error);
        logger.error({ error, message: 'Error uploading missionary image' });
        toast({
          title: t('common.error'),
          description: t('missionaryWork.images.uploadError'),
          variant: 'destructive',
        });
        setUploadedFiles((prev) => {
          const toRemove = prev.find((i) => i.id === id);
          if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
          return prev.filter((i) => i.id !== id);
        });
      }
    }
  };

  const handleSave = async (item: {
    id: string;
    file: File;
    previewUrl: string;
    url: string | null;
    description: string;
    status: 'uploading' | 'processing' | 'ready';
    progress: number;
  }) => {
    if (item.status !== 'ready' || !item.url) return;
    if (!missionaryImagesCollection) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.collectionUnavailable'),
        variant: 'destructive',
      });
      return;
    }

    startTransition(async () => {
      try {
        await addDoc(missionaryImagesCollection, {
          imageUrl: item.url,
          description: item.description,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'unknown',
          barrioOrg,
        });
        toast({
          title: t('missionaryWork.success'),
          description: t('missionaryWork.images.saved'),
        });
        setUploadedFiles((prev) => {
          const toRemove = prev.find((i) => i.id === item.id);
          if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
          return prev.filter((i) => i.id !== item.id);
        });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error saving missionary image' });
        toast({
          title: t('common.error'),
          description: t('missionaryWork.images.saveError'),
          variant: 'destructive',
        });
      }
    });
  };

  const handleDeletePending = (id: string) => {
    setUploadedFiles((prev) => {
      const toRemove = prev.find((i) => i.id === id);
      if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const handleEdit = async (id: string, newDescription: string) => {
    if (!missionaryImagesCollection) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.collectionUnavailable'),
        variant: 'destructive',
      });
      return;
    }
    startTransition(async () => {
      try {
        await updateDoc(doc(missionaryImagesCollection, id), {
          description: newDescription,
        });
        toast({
          title: t('missionaryWork.success'),
          description: t('missionaryWork.images.descriptionUpdated'),
        });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error updating image description' });
        toast({
          title: t('common.error'),
          description: t('missionaryWork.images.descriptionUpdateError'),
          variant: 'destructive',
        });
      }
    });
  };

  const handleDelete = async (id: string) => {
    if (!missionaryImagesCollection) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.collectionUnavailable'),
        variant: 'destructive',
      });
      return;
    }
    startTransition(async () => {
      try {
        await deleteDoc(doc(missionaryImagesCollection, id));
        toast({
          title: t('missionaryWork.success'),
          description: t('missionaryWork.images.deleted'),
        });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error deleting missionary image' });
        toast({
          title: t('common.error'),
          description: t('missionaryWork.images.deleteError'),
          variant: 'destructive',
        });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>{t('missionaryWork.images.title')}</CardTitle>
            <CardDescription>
              {t('missionaryWork.images.description')}
            </CardDescription>
          </div>
          <div>
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              id="image-upload"
            />
            <Label htmlFor="image-upload">
              <Button size="sm" asChild>
                <span>
                  {uploadedFiles.some((file) => file.status === 'uploading') ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('missionaryWork.images.uploading')}
                    </>
                  ) : uploadedFiles.some((file) => file.status === 'processing') ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('missionaryWork.images.processing')}
                    </>
                  ) : (
                    <>
                      <PlusCircle className="mr-2" />
                      {t('missionaryWork.images.uploadButton')}
                    </>
                  )}
                </span>
              </Button>
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-6">
            {uploadedFiles.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  {t('missionaryWork.images.pendingTitle')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {uploadedFiles.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <Image
                          src={item.url ?? item.previewUrl}
                          alt="Uploaded"
                          width={480}
                          height={128}
                          className="w-full h-32 object-cover rounded mb-2"
                          unoptimized
                          style={{ width: '100%', height: '8rem' }}
                        />
                        {item.status === 'uploading' && (
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t('missionaryWork.images.uploadingImageProgress', {
                              progress: item.progress,
                            })}
                          </div>
                        )}
                        {item.status === 'processing' && (
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t('missionaryWork.images.processingText')}
                          </div>
                        )}
                        <Textarea
                          value={item.description}
                          onChange={(e) =>
                            setUploadedFiles((prev) =>
                              prev.map((i) =>
                                i.id === item.id
                                  ? { ...i, description: e.target.value }
                                  : i
                              )
                            )
                          }
                          placeholder={
                            item.status === 'uploading'
                              ? t('missionaryWork.images.uploadingImage')
                              : item.status === 'processing'
                                ? t('missionaryWork.images.processingText')
                                : t('missionaryWork.images.descriptionPlaceholder')
                          }
                          disabled={item.status !== 'ready'}
                          className="mb-2"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSave(item)}
                            disabled={item.status !== 'ready' || !item.url || isPending}
                          >
                            {t('missionaryWork.images.saveButton')}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeletePending(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {images.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  {t('missionaryWork.images.savedTitle')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {images.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <Image
                          src={item.imageUrl}
                          alt="Missionary"
                          width={480}
                          height={128}
                          className="w-full h-32 object-cover rounded mb-2"
                          unoptimized
                          style={{ width: '100%', height: '8rem' }}
                        />
                        <Textarea
                          value={item.description}
                          onChange={(e) => handleEdit(item.id, e.target.value)}
                          className="mb-2"
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(item.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('missionaryWork.images.deleteButton')}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {uploadedFiles.length === 0 && images.length === 0 && (
              <p className="text-sm text-center py-4 text-muted-foreground">
                {t('missionaryWork.images.noImages')}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
