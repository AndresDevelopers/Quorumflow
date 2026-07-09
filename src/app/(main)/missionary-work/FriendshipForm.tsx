
'use client';

import { useTransition, useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { newConvertFriendsCollection } from '@/lib/collections';
import type { Convert, NewConvertFriendship } from '@/lib/types';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { PlusCircle, Trash2 } from 'lucide-react';
import { MemberSelector } from '@/components/members/member-selector';

type FormValues = {
  friends: Array<{ name: string }>;
};

interface FriendshipFormProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onFormSubmit: () => void;
  convert?: Convert | null;
  friendship?: NewConvertFriendship | null;
}

export function FriendshipForm({
  isOpen,
  onOpenChange,
  onFormSubmit,
  convert,
  friendship,
}: FriendshipFormProps) {
  const isEditMode = !!friendship;
  const { toast } = useToast();
  const { barrioOrg } = useAuth();
  const { canWrite } = usePermission();
  const [isPending, startTransition] = useTransition();
  const isSocorro = barrioOrg?.toLowerCase().includes('socorro');
  const { t } = useI18n();

  const friendSchema = z.object({
    name: z.string().min(2, t('friendship.nameRequired')),
  });

  const getFriendshipSchema = (allowEmptyFriends: boolean) =>
    z.object({
      friends: z.array(friendSchema).min(allowEmptyFriends ? 0 : 1, t('friendship.minOne')),
    });

  const form = useForm<FormValues>({
    resolver: zodResolver(getFriendshipSchema(isEditMode)),
    defaultValues: {
      friends: [{ name: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'friends',
  });

  useEffect(() => {
    if (isOpen) {
      if (isEditMode && friendship) {
        form.reset({ friends: friendship.friends.map((name) => ({ name })) });
      } else {
        form.reset({ friends: [{ name: '' }] });
      }
    }
  }, [isOpen, isEditMode, friendship, form]);


  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      try {
        const friendNames = values.friends
          .map((f) => f.name.trim())
          .filter((name) => name.length > 0);
        if (isEditMode && friendship) {
          const friendshipRef = doc(newConvertFriendsCollection, friendship.id);
          if (friendNames.length === 0) {
            await deleteDoc(friendshipRef);
            toast({
              title: t('missionaryWork.success'),
              description: t('friendship.deleted'),
            });
          } else {
            await updateDoc(friendshipRef, { friends: friendNames });
            toast({
              title: t('missionaryWork.success'),
              description: t('friendship.updated'),
            });
          }
        } else if (convert) {
          await addDoc(newConvertFriendsCollection, {
            convertId: convert.id,
            convertName: convert.name,
            friends: friendNames,
            assignedAt: serverTimestamp(),
            barrioOrg,
          });
          toast({
            title: t('missionaryWork.success'),
            description: t('friendship.assigned'),
          });
        }
        onFormSubmit();
      } catch (error) {
        logger.error({ error, message: 'Error saving friendship' });
        toast({
          title: t('common.error'),
          description: t('friendship.saveError'),
          variant: 'destructive',
        });
      }
    });
  };

  const targetName = (isEditMode ? friendship?.convertName : convert?.name) ?? '';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>
                {isEditMode ? t('friendship.editTitle', { name: targetName }) : t('friendship.assignTitle', { name: targetName })}
              </DialogTitle>
              <DialogDescription>
                {isSocorro ? t('friendship.descriptionSocorro') : t('friendship.descriptionQuorum')}
                <br />
                <span className="text-sm text-muted-foreground">{t('birthdayForm.requiredFields')}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label>{t('missionaryWork.newConverts.table.friendsHeader')} *</Label>
                {fields.map((field, index) => (
                  <FormField
                    key={field.id}
                    control={form.control}
                    name={`friends.${index}.name`}
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <MemberSelector
                              value={field.value}
                              onValueChange={(memberId) => field.onChange(memberId)}
                              placeholder={t('friendship.selectPlaceholder', { n: index + 1 })}
                              statusFilter={["active"]}
                              allowClear={false}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ name: '' })}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                {t('friendship.addFriend')}
              </Button>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? t('friendship.saving') : t('friendship.saveButton')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
