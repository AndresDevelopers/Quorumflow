'use client';

import { useState, useEffect } from 'react';
import type { FamilySearchAnnotation } from '@/lib/types';
import { doc, updateDoc } from 'firebase/firestore';
import { familySearchAnnotationsCollection } from '@/lib/collections';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/contexts/i18n-context';

interface EditFamilySearchAnnotationDialogProps {
  annotation: FamilySearchAnnotation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnnotationUpdated: () => void;
}

export function EditFamilySearchAnnotationDialog({
  annotation,
  open,
  onOpenChange,
  onAnnotationUpdated,
}: EditFamilySearchAnnotationDialogProps) {
  const { t } = useI18n();
  const [editedNote, setEditedNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (annotation) {
      setEditedNote(annotation.note);
    }
  }, [annotation]);

  const handleSave = async () => {
    if (!annotation || !editedNote.trim()) return;

    setIsLoading(true);
    try {
      const annotationRef = doc(familySearchAnnotationsCollection, annotation.id);
      await updateDoc(annotationRef, {
        note: editedNote.trim(),
      });
      
      onAnnotationUpdated();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating FamilySearch annotation:', error);
      // Optionally show a toast notification here
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('familySearch.editAnnotation.title')}</DialogTitle>
          <DialogDescription>
            {t('familySearch.editAnnotation.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            value={editedNote}
            onChange={(e) => setEditedNote(e.target.value)}
            placeholder={t('familySearch.editAnnotation.placeholder')}
            rows={4}
            className="resize-none"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t('familySearch.editAnnotation.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || !editedNote.trim()}
          >
            {isLoading ? t('familySearch.editAnnotation.saving') : t('familySearch.editAnnotation.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}