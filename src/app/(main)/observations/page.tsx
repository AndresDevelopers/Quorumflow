'use client';



import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { OfflineImage } from '@/components/offline-image';

import type { ChangeEvent } from 'react';

import { Users, AlertTriangle, UserX, UserCheck, Eye, ChevronUp, HeartPulse, Plus, Trash2, Loader2, Check, ChevronsUpDown, X, Pencil } from 'lucide-react';

import {

  Card,

  CardContent,

  CardDescription,

  CardHeader,

  CardTitle,

} from '@/components/ui/card';

import {

  Table,

  TableBody,

  TableCell,

  TableHead,

  TableHeader,

  TableRow,

} from '@/components/ui/table';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { Button } from '@/components/ui/button';

import { Badge } from '@/components/ui/badge';

import { Skeleton } from '@/components/ui/skeleton';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

import { Input } from '@/components/ui/input';

import { Textarea } from '@/components/ui/textarea';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';

import { cn } from '@/lib/utils';

import { useForm } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';

import { z } from 'zod';

import { useToast } from '@/hooks/use-toast';

import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';

import type { Member, Companionship, Family, HealthConcern } from '@/lib/types';

import { getMembersByStatus } from '@/lib/members-data';

import { fetchHealthConcerns, createHealthConcern, deleteHealthConcern, updateHealthConcern } from '@/lib/health-concerns';

import { format, subMonths, differenceInYears } from 'date-fns';

import { getDateFnsLocale } from "@/lib/i18n-date";

import { useRouter } from 'next/navigation';

import { query, orderBy, where } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';

import { ministeringCollection } from '@/lib/collections';



const statusConfig = {

  active: {

    variant: 'default' as const,

    icon: UserCheck,

    color: 'text-green-600'

  },

  less_active: {

    variant: 'secondary' as const,

    icon: UserX,

    color: 'text-yellow-600'

  },

  inactive: {

    variant: 'destructive' as const,

    icon: UserX,

    color: 'text-red-600'

  },

  deceased: {

    variant: 'secondary' as const,

    icon: UserX,

    color: 'text-muted-foreground'

  }

};

const HEALTH_PHOTO_MAX_SIZE = 5 * 1024 * 1024;

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const createHealthConcernSchema = (t: TranslateFn) =>
  z.object({
    firstName: z.string().min(2, { message: t('observations.health.validation.firstName') }),
    lastName: z.string().min(2, { message: t('observations.health.validation.lastName') }),
    address: z.string().min(5, { message: t('observations.health.validation.address') }),
    observation: z.string().min(5, { message: t('observations.health.validation.observation') }),
    helperIds: z.array(z.string()).min(1, { message: t('observations.health.validation.helpers') }),
  });

type HealthConcernFormValues = z.infer<ReturnType<typeof createHealthConcernSchema>>;
const DEFAULT_HEALTH_FORM_VALUES: HealthConcernFormValues = {
  firstName: '',
  lastName: '',
  address: '',
  observation: '',
  helperIds: [],
};

const getInitials = (first: string, last: string) => `${(first?.[0] ?? '').toUpperCase()}${(last?.[0] ?? '').toUpperCase()}`.trim() || 'PS';

const renderPhoneWithAge = (member: Member, fallback: string, ageLabel: (age: number) => string) => {
  let text = member.phoneNumber || fallback;
  if (member.birthDate) {
    const age = differenceInYears(new Date(), member.birthDate.toDate());
    text += ` - ${ageLabel(age)}`;
  }
  return text;
};



export default function ObservationsPage() {

  const { user, loading: authLoading, barrioOrg, organizacion } = useAuth();
  const { canWrite } = usePermission();
  const { t } = useI18n();

  const isElderesQuorum = organizacion.toLowerCase().includes('élder') || organizacion.toLowerCase().includes('elder');

  const { toast } = useToast();

  const router = useRouter();

  const [members, setMembers] = useState<Member[]>([]);

  const [companionships, setCompanionships] = useState<Companionship[]>([]);

  const [loading, setLoading] = useState(true);

  const [showScrollTop, setShowScrollTop] = useState(false);



  const [healthConcerns, setHealthConcerns] = useState<HealthConcern[]>([]);

  const [healthLoading, setHealthLoading] = useState(true);

  const [healthDialogOpen, setHealthDialogOpen] = useState(false);

  const [savingHealthConcern, setSavingHealthConcern] = useState(false);

  const [deletingHealthConcernId, setDeletingHealthConcernId] = useState<string | null>(null);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [helperPickerOpen, setHelperPickerOpen] = useState(false);

  const [editingHealthConcern, setEditingHealthConcern] = useState<HealthConcern | null>(null);

  const [removeExistingPhoto, setRemoveExistingPhoto] = useState(false);



  const healthConcernsRef = useRef<HTMLDivElement>(null);

  const withoutEndowmentRef = useRef<HTMLDivElement>(null);
  const withoutElderOrdinationRef = useRef<HTMLDivElement>(null);

  const withoutHigherPriesthoodRef = useRef<HTMLDivElement>(null);

  const withoutMinisteringRef = useRef<HTMLDivElement>(null);

  const inactiveRef = useRef<HTMLDivElement>(null);

  const inactiveNewConvertsRef = useRef<HTMLDivElement>(null);

  const familyFocusCompanionshipsRef = useRef<HTMLDivElement>(null);

  const problematicCompanionshipsRef = useRef<HTMLDivElement>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);

  const healthForm = useForm<HealthConcernFormValues>({

    resolver: zodResolver(createHealthConcernSchema(t)),

    defaultValues: DEFAULT_HEALTH_FORM_VALUES,

  });

  const watchFirstName = healthForm.watch('firstName');

  const watchLastName = healthForm.watch('lastName');

  const isEditingHealthConcern = Boolean(editingHealthConcern);



  const membersById = useMemo(() => {

    const map = new Map<string, Member>();

    members.forEach(member => {

      map.set(member.id, member);

    });

    return map;

  }, [members]);



  const fetchMembers = useCallback(async () => {

    if (authLoading || !user) return;



    setLoading(true);

    try {

      const allMembers = await getMembersByStatus(undefined, { barrioOrg });

      setMembers(allMembers);

    } catch (error) {

      console.error('Error fetching members:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.loadMembersError'),

        variant: 'destructive'

      });

    } finally {

      setLoading(false);

    }

  }, [authLoading, user, toast, t, barrioOrg]);



  const fetchCompanionships = useCallback(async () => {

    try {

      const q = query(
        ministeringCollection,
        where('barrioOrg', '==', barrioOrg),
        orderBy('companions')
      );

      const snapshot = await getDocs(q);

      const comps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Companionship));

      setCompanionships(comps);

    } catch (error) {

      console.error('Error fetching companionships:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.loadCompanionshipsError'),

        variant: 'destructive'

      });

    }

  }, [toast, t, barrioOrg]);
  const loadHealthConcerns = useCallback(async () => {

    if (authLoading || !user) {

      return;

    }



    setHealthLoading(true);



    try {

      const healthData = await fetchHealthConcerns(barrioOrg);

      setHealthConcerns(healthData);

    } catch (error) {

      console.error('Error fetching health concerns:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.loadHealthError'),

        variant: 'destructive'

      });

    } finally {

      setHealthLoading(false);

    }



  }, [authLoading, user, toast, t, barrioOrg]);










  useEffect(() => {



    fetchMembers();



    fetchCompanionships();



    loadHealthConcerns();



  }, [fetchMembers, fetchCompanionships, loadHealthConcerns]);




  useEffect(() => {

    const handleScroll = () => {

      setShowScrollTop(window.scrollY > 300);

    };

    window.addEventListener('scroll', handleScroll);

    return () => window.removeEventListener('scroll', handleScroll);

  }, []);



  const handleViewProfile = (memberId: string) => {

    router.push(`/members/${memberId}`);

  };



  const resetHealthForm = () => {

    healthForm.reset(DEFAULT_HEALTH_FORM_VALUES);

    if (photoPreview && photoPreview.startsWith('blob:')) {

      URL.revokeObjectURL(photoPreview);

    }

    setPhotoPreview(null);

    setPhotoFile(null);

    setHelperPickerOpen(false);

    setEditingHealthConcern(null);

    setRemoveExistingPhoto(false);

    if (photoInputRef.current) {

      photoInputRef.current.value = '';

    }

  };



  const handleOpenHealthDialog = (concern?: HealthConcern) => {

    if (photoPreview && photoPreview.startsWith('blob:')) {

      URL.revokeObjectURL(photoPreview);

    }

    if (concern) {

      setEditingHealthConcern(concern);

      healthForm.reset({

        firstName: concern.firstName ?? '',

        lastName: concern.lastName ?? '',

        address: concern.address ?? '',

        observation: concern.observation ?? '',

        helperIds: Array.isArray(concern.helperIds) ? concern.helperIds : [],

      });

      setPhotoPreview(concern.photoURL ?? null);

      setPhotoFile(null);

      setRemoveExistingPhoto(false);

      setHelperPickerOpen(false);

      if (photoInputRef.current) {

        photoInputRef.current.value = '';

      }

    } else {

      resetHealthForm();

    }

    setHealthDialogOpen(true);

  };



  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {

    const file = event.target.files?.[0];

    if (!file) {

      return;

    }



    if (file.size > HEALTH_PHOTO_MAX_SIZE) {

      toast({

        title: t('observations.toast.photoTooLargeTitle'),

        description: t('observations.toast.photoTooLargeDescription'),

        variant: 'destructive'

      });

      if (photoInputRef.current) {

        photoInputRef.current.value = '';

      }

      return;

    }



    if (photoPreview && photoPreview.startsWith('blob:')) {

      URL.revokeObjectURL(photoPreview);

    }



    const previewUrl = URL.createObjectURL(file);

    setPhotoPreview(previewUrl);

    setPhotoFile(file);

    setRemoveExistingPhoto(false);

  };



  const handleRemovePhoto = () => {

    if (photoFile) {

      if (photoPreview && photoPreview.startsWith('blob:')) {

        URL.revokeObjectURL(photoPreview);

      }

      setPhotoFile(null);

      if (editingHealthConcern?.photoURL) {

        setPhotoPreview(editingHealthConcern.photoURL);

        setRemoveExistingPhoto(false);

      } else {

        setPhotoPreview(null);

      }

    } else {

      if (photoPreview && photoPreview.startsWith('blob:')) {

        URL.revokeObjectURL(photoPreview);

      }

      setPhotoPreview(null);

      setRemoveExistingPhoto(Boolean(editingHealthConcern?.photoURL));

    }

    setPhotoFile(null);

    if (photoInputRef.current) {

      photoInputRef.current.value = '';

    }

  };



  const toggleHelper = (memberId: string) => {

    const currentHelpers = healthForm.getValues('helperIds');

    const updatedHelpers = currentHelpers.includes(memberId)

      ? currentHelpers.filter(id => id !== memberId)

      : [...currentHelpers, memberId];

    healthForm.setValue('helperIds', updatedHelpers, { shouldValidate: true });

  };



  const handleHealthSubmit = async (values: HealthConcernFormValues) => {

    if (!user) {

      toast({

        title: t('common.error'),

        description: t('observations.toast.mustSignIn'),

        variant: 'destructive'

      });

      return;

    }



    setSavingHealthConcern(true);



    try {

      const helperNames = values.helperIds.map((id) => {

        const helper = membersById.get(id);

        if (helper) {

          return `${helper.firstName} ${helper.lastName}`;

        }

        return t('observations.health.memberUnregistered');

      });



      if (editingHealthConcern) {

        const updatedConcern = await updateHealthConcern({

          concern: editingHealthConcern,

          firstName: values.firstName.trim(),

          lastName: values.lastName.trim(),

          address: values.address.trim(),

          observation: values.observation.trim(),

          helperIds: values.helperIds,

          helperNames,

          performedBy: user.uid,

          photoFile,

          removePhoto: removeExistingPhoto && !photoFile,

        });



        setHealthConcerns((prev) => prev.map((item) => (item.id === updatedConcern.id ? updatedConcern : item)));



        toast({

          title: t('observations.toast.healthUpdatedTitle'),

          description: t('observations.toast.healthUpdatedDescription'),

        });

      } else {

        const newConcern = await createHealthConcern({

          firstName: values.firstName.trim(),

          lastName: values.lastName.trim(),

          address: values.address.trim(),

          observation: values.observation.trim(),

          helperIds: values.helperIds,

          helperNames,

          createdBy: user.uid,
          barrioOrg,
          photoFile,

        });



        setHealthConcerns((prev) => [newConcern, ...prev]);



        toast({

          title: t('observations.toast.healthCreatedTitle'),

          description: t('observations.toast.healthCreatedDescription'),

        });

      }



      setHealthDialogOpen(false);

      resetHealthForm();

    } catch (error) {

      console.error('Error saving health concern:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.healthSaveError'),

        variant: 'destructive'

      });

    } finally {

      setSavingHealthConcern(false);

    }

  };



  const handleDeleteHealthConcern = async (concern: HealthConcern) => {

    const confirmed = window.confirm(
      t('observations.confirm.deleteHealth', {
        firstName: concern.firstName,
        lastName: concern.lastName,
      })
    );

    if (!confirmed) {

      return;

    }



    setDeletingHealthConcernId(concern.id);



    try {

      await deleteHealthConcern(concern.id, concern.photoPath);

      setHealthConcerns((prev) => prev.filter((item) => item.id !== concern.id));

      if (editingHealthConcern?.id === concern.id) {

        resetHealthForm();

        setHealthDialogOpen(false);

      }

      toast({

        title: t('observations.toast.healthDeletedTitle'),

        description: t('observations.toast.healthDeletedDescription'),

      });

    } catch (error) {

      console.error('Error deleting health concern:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.healthDeleteError'),

        variant: 'destructive'

      });

    } finally {

      setDeletingHealthConcernId(null);

    }

  };



  // Filtrar miembros por criterios

  const membersWithoutEndowment = members.filter(member =>

    !member.ordinances || !member.ordinances.includes('endowment')

  );



  const membersWithoutElderOrdination = members.filter(member =>

    !member.ordinances || !member.ordinances.includes('elder_ordination')

  );



  const membersWithoutHigherPriesthood = members.filter(member =>

    !member.ordinances || (!member.ordinances.includes('elder_ordination') && !member.ordinances.includes('high_priest_ordination'))

  );



  const membersWithoutMinistering = members.filter(member =>

    !member.ministeringTeachers || member.ministeringTeachers.length === 0

  );



  const inactiveMembers = members.filter(member => member.status === 'inactive');

  const twentyFourMonthsAgo = subMonths(new Date(), 24);
  const inactiveNewConverts = members.filter(member =>
    member.status === 'inactive' &&
    member.baptismDate?.toDate &&
    member.baptismDate.toDate() > twentyFourMonthsAgo
  );



  // Filter companionships where companions are less active or inactive

  const problematicCompanionships = companionships.filter(companionship => {

    return companionship.companions.some(companionName => {

      const member = members.find(m =>

        `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

      );

      return member && (member.status === 'less_active' || member.status === 'inactive');

    });

  });



  const membersByFullName = useMemo(() => {

    const map = new Map<string, Member>();

    members.forEach(member => {

      map.set(`${member.firstName} ${member.lastName}`.toLowerCase(), member);

    });

    return map;

  }, [members]);



  const membersByLastName = useMemo(() => {

    const map = new Map<string, Member[]>();

    members.forEach(member => {

      const key = member.lastName.toLowerCase();

      const existing = map.get(key) ?? [];

      existing.push(member);

      map.set(key, existing);

    });

    return map;

  }, [members]);



  const resolveFamilyMembers = useCallback((familyName: string): Member[] => {

    const normalized = familyName.trim().toLowerCase();

    if (normalized.startsWith('familia ')) {

      const lastName = normalized.replace('familia ', '').trim();

      return membersByLastName.get(lastName) ?? [];

    }



    const directMatch = membersByFullName.get(normalized);

    if (directMatch) {

      return [directMatch];

    }



    return membersByLastName.get(normalized) ?? [];

  }, [membersByFullName, membersByLastName]);



  type FlaggedFamily = {

    family: Family;

    members: Member[];

  };



  type FamilyFocusCompanionship = Companionship & {

    flaggedFamilies: FlaggedFamily[];

  };



  const familyFocusCompanionships: FamilyFocusCompanionship[] = useMemo(() => {

    return companionships.map((companionship) => {

      const flaggedFamilies = companionship.families

        .map<FlaggedFamily | null>((family) => {

          const relatedMembers = resolveFamilyMembers(family.name);

          const flaggedMembers = relatedMembers.filter(member =>

            member.status === 'inactive' || member.status === 'less_active'

          );

          return flaggedMembers.length > 0 ? { family, members: flaggedMembers } : null;

        })

        .filter((entry): entry is FlaggedFamily => entry !== null);



      if (flaggedFamilies.length === 0) {

        return null;

      }



      return { ...companionship, flaggedFamilies };

    }).filter((entry): entry is FamilyFocusCompanionship => entry !== null);

  }, [companionships, resolveFamilyMembers]);



  const observationCounts = {

    withoutEndowment: membersWithoutEndowment.length,

    withoutElderOrdination: membersWithoutElderOrdination.length,

    withoutHigherPriesthood: membersWithoutHigherPriesthood.length,

    withoutMinistering: membersWithoutMinistering.length,

    inactiveNewConverts: inactiveNewConverts.length,

    inactive: inactiveMembers.length,

    familyFocusCompanionships: familyFocusCompanionships.length,

    problematicCompanionships: problematicCompanionships.length,

    healthConcerns: healthConcerns.length

  };



  return (

    <section className="page-section">

      {/* Header */}

      <div className="flex flex-col gap-2">

        <h1 className="text-balance text-fluid-title font-semibold tracking-tight">{t('observations.title')}</h1>

        <p className="text-balance text-fluid-subtitle text-muted-foreground">

          {t('observations.subtitle')}

        </p>

      </div>



      {/* Stats Cards */}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">

        <Card className="cursor-pointer" onClick={() => withoutEndowmentRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutEndowment')}</CardTitle>

            <AlertTriangle className="h-4 w-4 text-orange-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-orange-600">{observationCounts.withoutEndowment}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutEndowmentDesc')}</p>

          </CardContent>

        </Card>

        {isElderesQuorum && (
        <Card className="cursor-pointer" onClick={() => withoutElderOrdinationRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutElder')}</CardTitle>
            <UserCheck className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{observationCounts.withoutElderOrdination}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutElderDesc')}</p>
          </CardContent>
        </Card>
        )}
        {isElderesQuorum && (
        <Card className="cursor-pointer" onClick={() => withoutHigherPriesthoodRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutHigherPriesthood')}</CardTitle>
            <UserCheck className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-600">{observationCounts.withoutHigherPriesthood}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutHigherPriesthoodDesc')}</p>
          </CardContent>
        </Card>
        )}

        <Card className="cursor-pointer" onClick={() => withoutMinisteringRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutMinistering')}</CardTitle>

            <UserX className="h-4 w-4 text-blue-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-blue-600">{observationCounts.withoutMinistering}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutMinisteringDesc')}</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => inactiveNewConvertsRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.inactiveNewConverts')}</CardTitle>
            <UserX className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{observationCounts.inactiveNewConverts}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.inactiveNewConvertsDesc')}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => inactiveRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.inactive')}</CardTitle>
            <UserX className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{observationCounts.inactive}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.inactiveDesc')}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => familyFocusCompanionshipsRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.familyFocus')}</CardTitle>

            <Users className="h-4 w-4 text-sky-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-sky-600">{observationCounts.familyFocusCompanionships}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.familyFocusDesc')}</p>

          </CardContent>

        </Card>



        <Card className="cursor-pointer" onClick={() => problematicCompanionshipsRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.problematicCompanionships')}</CardTitle>

            <Users className="h-4 w-4 text-orange-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-orange-600">{observationCounts.problematicCompanionships}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.problematicCompanionshipsDesc')}</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => healthConcernsRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.health')}</CardTitle>

            <HeartPulse className="h-4 w-4 text-rose-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-rose-600">{observationCounts.healthConcerns}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.healthDesc')}</p>

          </CardContent>

        </Card>

      </div>



      {/* Sección Salud */}
      <Card ref={healthConcernsRef}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-rose-600" />
            {t('observations.health.sectionTitle')}
          </CardTitle>
          <CardDescription>
            {t('observations.health.sectionDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t('observations.health.sectionHint')}
            </p>
            {canWrite && (
            <Button onClick={() => handleOpenHealthDialog()} disabled={savingHealthConcern} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {t('observations.health.addPerson')}
            </Button>
            )}
          </div>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('observations.health.col.person')}</TableHead>
                  <TableHead>{t('observations.health.col.address')}</TableHead>
                  <TableHead>{t('observations.health.col.observation')}</TableHead>
                  <TableHead>{t('observations.health.col.helpers')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {healthLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-64" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-36" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : healthConcerns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      {t('observations.health.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  healthConcerns.map((concern) => {
                    const helperIds = Array.isArray(concern.helperIds) ? concern.helperIds : [];
                    const helpers = helperIds.length > 0
                      ? helperIds.map((helperId, index) => {
                        const helper = membersById.get(helperId);
                        const helperName = helper
                          ? `${helper.firstName} ${helper.lastName}`
                          : (concern.helperNames?.[index] ?? t('observations.health.memberUnregistered'));
                        return (
                          <Badge key={`${concern.id}-${helperId}-${index}`} variant="outline" className="text-xs font-normal">
                            {helperName}
                          </Badge>
                        );
                      })
                      : [];

                    const createdAtLabel = concern.createdAt
                      ? format(concern.createdAt.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })
                      : t('observations.health.dateUnavailable');

                    return (
                      <TableRow key={concern.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarImage
                                src={concern.photoURL || undefined}
                                alt={`${concern.firstName} ${concern.lastName}`}
                              />
                              <AvatarFallback>{getInitials(concern.firstName, concern.lastName)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{concern.firstName} {concern.lastName}</p>
                              <p className="text-xs text-muted-foreground">{t('observations.health.registeredOn', { date: createdAtLabel })}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <p className="text-sm text-muted-foreground break-words">{concern.address}</p>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <p className="text-sm text-muted-foreground break-words">{concern.observation}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {helpers.length > 0 ? helpers : <span className="text-sm text-muted-foreground">{t('common.unassigned')}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {canWrite && (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenHealthDialog(concern)}
                              disabled={savingHealthConcern}
                              title={t('observations.health.editTitle')}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteHealthConcern(concern)}
                              disabled={deletingHealthConcernId === concern.id}
                              title={t('observations.health.deleteTitle')}
                            >
                              {deletingHealthConcernId === concern.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden space-y-4">
            {healthLoading ? (
              Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-36 w-full" />
              ))
            ) : healthConcerns.length === 0 ? (
              <div className="py-12 text-center">
                <HeartPulse className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  {t('observations.health.empty')}
                </p>
              </div>
            ) : (
              healthConcerns.map((concern) => {
                const helperIds = Array.isArray(concern.helperIds) ? concern.helperIds : [];
                const helpers = helperIds.length > 0
                  ? helperIds.map((helperId, index) => {
                    const helper = membersById.get(helperId);
                    const helperName = helper
                      ? `${helper.firstName} ${helper.lastName}`
                      : (concern.helperNames?.[index] ?? t('observations.health.memberUnregistered'));
                    return (
                      <Badge key={`${concern.id}-${helperId}-${index}`} variant="outline" className="text-xs font-normal">
                        {helperName}
                      </Badge>
                    );
                  })
                  : [];

                const createdAtLabel = concern.createdAt
                  ? format(concern.createdAt.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })
                  : t('observations.health.dateUnavailable');

                return (
                  <Card key={concern.id}>
                    <CardContent className="space-y-4 pt-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarImage
                            src={concern.photoURL || undefined}
                            alt={`${concern.firstName} ${concern.lastName}`}
                          />
                          <AvatarFallback>{getInitials(concern.firstName, concern.lastName)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold">{concern.firstName} {concern.lastName}</h3>
                          <p className="text-sm text-muted-foreground">{concern.address}</p>
                          <p className="text-xs text-muted-foreground mt-1">{t('observations.health.registeredOn', { date: createdAtLabel })}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">{t('observations.health.col.observation')}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{concern.observation}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">{t('observations.health.col.helpers')}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {helpers.length > 0 ? helpers : <span className="text-sm text-muted-foreground">{t('common.unassigned')}</span>}
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        {canWrite && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenHealthDialog(concern)}
                          disabled={savingHealthConcern}
                          title={t('observations.health.editTitle')}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        )}
                        {canWrite && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteHealthConcern(concern)}
                          disabled={deletingHealthConcernId === concern.id}
                          title={t('observations.health.deleteTitle')}
                        >
                          {deletingHealthConcernId === concern.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sección Sin Investidura */}

      <Card ref={withoutEndowmentRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <AlertTriangle className="h-5 w-5 text-orange-600" />

            {t('observations.endowment.sectionTitle')}

          </CardTitle>

          <CardDescription>

            {t('observations.endowment.sectionDescription')}

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>{t('common.name')}</TableHead>

                  <TableHead>{t('common.phone')}</TableHead>

                  <TableHead>{t('common.status')}</TableHead>

                  <TableHead>{t('observations.col.ordinancesReceived')}</TableHead>

                  <TableHead className="text-right">{t('common.actions')}</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : membersWithoutEndowment.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={5} className="h-24 text-center">

                      {t('observations.endowment.empty')}

                    </TableCell>

                  </TableRow>

                ) : (

                  membersWithoutEndowment.map((member) => {

                    const statusInfo = statusConfig[member.status];

                    const StatusIcon = statusInfo.icon;



                    return (

                      <TableRow key={member.id}>

                        <TableCell className="font-medium">

                          <div className="flex items-center gap-3">

                            {member.photoURL ? (

                              <OfflineImage
                                src={member.photoURL}
                                alt={`${member.firstName} ${member.lastName}`}
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full object-cover"
                              />

                            ) : (

                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">

                                <Users className="h-4 w-4 text-muted-foreground" />

                              </div>

                            )}

                            <span>{member.firstName} {member.lastName}</span>

                          </div>

                        </TableCell>

                        <TableCell>{renderPhoneWithAge(member, t('common.notSpecified'), (age) => t('observations.ageSuffix', { age }))}</TableCell>

                        <TableCell>

                          <Badge variant={statusInfo.variant} className="gap-1">

                            <StatusIcon className="h-3 w-3" />

                            {t(`member.status.${member.status}`)}

                          </Badge>

                        </TableCell>

                        <TableCell>

                          <div className="flex flex-wrap gap-1">

                            {member.ordinances && member.ordinances.length > 0 ? (

                              member.ordinances.map((ordinance) => (

                                <Badge key={ordinance} variant="outline" className="text-xs">

                                  {t(`ordinance.${ordinance}`)}

                                </Badge>

                              ))

                            ) : (

                              <span className="text-muted-foreground text-sm">{t('common.none')}</span>

                            )}

                          </div>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => handleViewProfile(member.id)}

                            title={t('common.viewProfile')}

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : membersWithoutEndowment.length === 0 ? (

              <div className="text-center py-12">

                <AlertTriangle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  {t('observations.endowment.empty')}

                </p>

              </div>

            ) : (

              membersWithoutEndowment.map((member) => {

                const statusInfo = statusConfig[member.status];

                const StatusIcon = statusInfo.icon;



                return (

                  <Card key={member.id}>

                    <CardContent className="pt-4">

                      <div className="flex items-start justify-between mb-3">

                        <div className="flex items-center gap-3">

                          {member.photoURL ? (
                            <OfflineImage
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={40}
                              height={40}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (

                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">

                              <Users className="h-5 w-5 text-muted-foreground" />

                            </div>

                          )}

                          <div>

                            <h3 className="font-semibold">{member.firstName} {member.lastName}</h3>

                            <p className="text-sm text-muted-foreground">

                              {renderPhoneWithAge(member, t('common.noPhone'), (age) => t('observations.ageSuffix', { age }))}

                            </p>

                          </div>

                        </div>

                        <Badge variant={statusInfo.variant} className="gap-1">

                          <StatusIcon className="h-3 w-3" />

                          {t(`member.status.${member.status}`)}

                        </Badge>

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">{t('observations.label.ordinances')}</p>

                        <div className="flex flex-wrap gap-1">

                          {member.ordinances && member.ordinances.length > 0 ? (

                            member.ordinances.map((ordinance) => (

                              <Badge key={ordinance} variant="outline" className="text-xs">

                                {t(`ordinance.${ordinance}`)}

                              </Badge>

                            ))

                          ) : (

                            <span className="text-muted-foreground text-sm">{t('common.none')}</span>

                          )}

                        </div>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          {t('common.viewProfile')}

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Sin Ordenanza de Elderes - Solo visible para Quórum de Élderes */}
      {isElderesQuorum && (
      <Card ref={withoutElderOrdinationRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <UserCheck className="h-5 w-5 text-purple-600" />

            {t('observations.elder.sectionTitle')}

          </CardTitle>

          <CardDescription>

            {t('observations.elder.sectionDescription')}

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>{t('common.name')}</TableHead>

                  <TableHead>{t('common.phone')}</TableHead>

                  <TableHead>{t('common.status')}</TableHead>

                  <TableHead>{t('observations.col.ordinancesReceived')}</TableHead>

                  <TableHead className="text-right">{t('common.actions')}</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : membersWithoutElderOrdination.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={5} className="h-24 text-center">

                      {t('observations.elder.empty')}

                    </TableCell>

                  </TableRow>

                ) : (

                  membersWithoutElderOrdination.map((member) => {

                    const statusInfo = statusConfig[member.status];

                    const StatusIcon = statusInfo.icon;



                    return (

                      <TableRow key={member.id}>

                        <TableCell className="font-medium">

                          <div className="flex items-center gap-3">

                            {member.photoURL ? (
                              <OfflineImage
                                src={member.photoURL}
                                alt={`${member.firstName} ${member.lastName}`}
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (

                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">

                                <Users className="h-4 w-4 text-muted-foreground" />

                              </div>

                            )}

                            <span>{member.firstName} {member.lastName}</span>

                          </div>

                        </TableCell>

                        <TableCell>{renderPhoneWithAge(member, t('common.notSpecified'), (age) => t('observations.ageSuffix', { age }))}</TableCell>

                        <TableCell>

                          <Badge variant={statusInfo.variant} className="gap-1">

                            <StatusIcon className="h-3 w-3" />

                            {t(`member.status.${member.status}`)}

                          </Badge>

                        </TableCell>

                        <TableCell>

                          <div className="flex flex-wrap gap-1">

                            {member.ordinances && member.ordinances.length > 0 ? (

                              member.ordinances.map((ordinance) => (

                                <Badge key={ordinance} variant="outline" className="text-xs">

                                  {t(`ordinance.${ordinance}`)}

                                </Badge>

                              ))

                            ) : (

                              <span className="text-muted-foreground text-sm">{t('common.none')}</span>

                            )}

                          </div>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => handleViewProfile(member.id)}

                            title={t('common.viewProfile')}

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : membersWithoutElderOrdination.length === 0 ? (

              <div className="text-center py-12">

                <UserCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  {t('observations.elder.empty')}

                </p>

              </div>

            ) : (

              membersWithoutElderOrdination.map((member) => {

                const statusInfo = statusConfig[member.status];

                const StatusIcon = statusInfo.icon;



                return (

                  <Card key={member.id}>

                    <CardContent className="pt-4">

                      <div className="flex items-start justify-between mb-3">

                        <div className="flex items-center gap-3">

                          {member.photoURL ? (
                            <OfflineImage
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={40}
                              height={40}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (

                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">

                              <Users className="h-5 w-5 text-muted-foreground" />

                            </div>

                          )}

                          <div>

                            <h3 className="font-semibold">{member.firstName} {member.lastName}</h3>

                            <p className="text-sm text-muted-foreground">

                              {renderPhoneWithAge(member, t('common.noPhone'), (age) => t('observations.ageSuffix', { age }))}

                            </p>

                          </div>

                        </div>

                        <Badge variant={statusInfo.variant} className="gap-1">

                          <StatusIcon className="h-3 w-3" />

                          {t(`member.status.${member.status}`)}

                        </Badge>

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">{t('observations.label.ordinances')}</p>

                        <div className="flex flex-wrap gap-1">

                          {member.ordinances && member.ordinances.length > 0 ? (

                            member.ordinances.map((ordinance) => (

                              <Badge key={ordinance} variant="outline" className="text-xs">

                                {t(`ordinance.${ordinance}`)}

                              </Badge>

                            ))

                          ) : (

                            <span className="text-muted-foreground text-sm">{t('common.none')}</span>

                          )}

                        </div>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          {t('common.viewProfile')}

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>
      )}

      {/* Sección Sin Sacerdocio Mayor - Solo visible para Quórum de Élderes */}
      {isElderesQuorum && (
      <Card ref={withoutHigherPriesthoodRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <UserCheck className="h-5 w-5 text-indigo-600" />

            {t('observations.higherPriesthood.sectionTitle')}

          </CardTitle>

          <CardDescription>

            {t('observations.higherPriesthood.sectionDescription')}

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>{t('common.name')}</TableHead>

                  <TableHead>{t('common.phone')}</TableHead>

                  <TableHead>{t('common.status')}</TableHead>

                  <TableHead>{t('observations.col.ordinancesReceived')}</TableHead>

                  <TableHead className="text-right">{t('common.actions')}</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : membersWithoutHigherPriesthood.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={5} className="h-24 text-center">

                      {t('observations.higherPriesthood.empty')}

                    </TableCell>

                  </TableRow>

                ) : (

                  membersWithoutHigherPriesthood.map((member) => {

                    const statusInfo = statusConfig[member.status];

                    const StatusIcon = statusInfo.icon;



                    return (

                      <TableRow key={member.id}>

                        <TableCell className="font-medium">

                          <div className="flex items-center gap-3">

                            {member.photoURL ? (
                              <OfflineImage
                                src={member.photoURL}
                                alt={`${member.firstName} ${member.lastName}`}
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (

                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">

                                <Users className="h-4 w-4 text-muted-foreground" />

                              </div>

                            )}

                            <span>{member.firstName} {member.lastName}</span>

                          </div>

                        </TableCell>

                        <TableCell>{renderPhoneWithAge(member, t('common.notSpecified'), (age) => t('observations.ageSuffix', { age }))}</TableCell>

                        <TableCell>

                          <Badge variant={statusInfo.variant} className="gap-1">

                            <StatusIcon className="h-3 w-3" />

                            {t(`member.status.${member.status}`)}

                          </Badge>

                        </TableCell>

                        <TableCell>

                          <div className="flex flex-wrap gap-1">

                            {member.ordinances && member.ordinances.length > 0 ? (

                              member.ordinances.map((ordinance) => (

                                <Badge key={ordinance} variant="outline" className="text-xs">

                                  {t(`ordinance.${ordinance}`)}

                                </Badge>

                              ))

                            ) : (

                              <span className="text-muted-foreground text-sm">{t('common.none')}</span>

                            )}

                          </div>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => handleViewProfile(member.id)}

                            title={t('common.viewProfile')}

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : membersWithoutHigherPriesthood.length === 0 ? (

              <div className="text-center py-12">

                <UserCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  {t('observations.higherPriesthood.empty')}

                </p>

              </div>

            ) : (

              membersWithoutHigherPriesthood.map((member) => {

                const statusInfo = statusConfig[member.status];

                const StatusIcon = statusInfo.icon;



                return (

                  <Card key={member.id}>

                    <CardContent className="pt-4">

                      <div className="flex items-start justify-between mb-3">

                        <div className="flex items-center gap-3">

                          {member.photoURL ? (
                            <OfflineImage
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={40}
                              height={40}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (

                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">

                              <Users className="h-5 w-5 text-muted-foreground" />

                            </div>

                          )}

                          <div>

                            <h3 className="font-semibold">{member.firstName} {member.lastName}</h3>

                            <p className="text-sm text-muted-foreground">

                              {renderPhoneWithAge(member, t('common.noPhone'), (age) => t('observations.ageSuffix', { age }))}

                            </p>

                          </div>

                        </div>

                        <Badge variant={statusInfo.variant} className="gap-1">

                          <StatusIcon className="h-3 w-3" />

                          {t(`member.status.${member.status}`)}

                        </Badge>

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">{t('observations.label.ordinances')}</p>

                        <div className="flex flex-wrap gap-1">

                          {member.ordinances && member.ordinances.length > 0 ? (

                            member.ordinances.map((ordinance) => (

                              <Badge key={ordinance} variant="outline" className="text-xs">

                                {t(`ordinance.${ordinance}`)}

                              </Badge>

                            ))

                          ) : (

                            <span className="text-muted-foreground text-sm">{t('common.none')}</span>

                          )}

                        </div>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          {t('common.viewProfile')}

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>
      )}

      {/* Sección Sin Maestros Ministrantes */}

      <Card ref={withoutMinisteringRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <UserX className="h-5 w-5 text-blue-600" />

            {t('observations.ministering.sectionTitle')}

          </CardTitle>

          <CardDescription>

            {t('observations.ministering.sectionDescription')}

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>{t('common.name')}</TableHead>

                  <TableHead>{t('common.phone')}</TableHead>

                  <TableHead>{t('common.status')}</TableHead>

                  <TableHead className="text-right">{t('common.actions')}</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : membersWithoutMinistering.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={4} className="h-24 text-center">

                      {t('observations.ministering.empty')}

                    </TableCell>

                  </TableRow>

                ) : (

                  membersWithoutMinistering.map((member) => {

                    const statusInfo = statusConfig[member.status];

                    const StatusIcon = statusInfo.icon;



                    return (

                      <TableRow key={member.id}>

                        <TableCell className="font-medium">

                          <div className="flex items-center gap-3">

                            {member.photoURL ? (
                              <OfflineImage
                                src={member.photoURL}
                                alt={`${member.firstName} ${member.lastName}`}
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (

                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">

                                <Users className="h-4 w-4 text-muted-foreground" />

                              </div>

                            )}

                            <span>{member.firstName} {member.lastName}</span>

                          </div>

                        </TableCell>

                        <TableCell>{renderPhoneWithAge(member, t('common.notSpecified'), (age) => t('observations.ageSuffix', { age }))}</TableCell>

                        <TableCell>

                          <Badge variant={statusInfo.variant} className="gap-1">

                            <StatusIcon className="h-3 w-3" />

                            {t(`member.status.${member.status}`)}

                          </Badge>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => handleViewProfile(member.id)}

                            title={t('common.viewProfile')}

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : membersWithoutMinistering.length === 0 ? (

              <div className="text-center py-12">

                <UserX className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  {t('observations.ministering.empty')}

                </p>

              </div>

            ) : (

              membersWithoutMinistering.map((member) => {

                const statusInfo = statusConfig[member.status];

                const StatusIcon = statusInfo.icon;



                return (

                  <Card key={member.id}>

                    <CardContent className="pt-4">

                      <div className="flex items-start justify-between mb-3">

                        <div className="flex items-center gap-3">

                          {member.photoURL ? (
                            <OfflineImage
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={40}
                              height={40}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (

                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">

                              <Users className="h-5 w-5 text-muted-foreground" />

                            </div>

                          )}

                          <div>

                            <h3 className="font-semibold">{member.firstName} {member.lastName}</h3>

                            <p className="text-sm text-muted-foreground">

                              {renderPhoneWithAge(member, t('common.noPhone'), (age) => t('observations.ageSuffix', { age }))}

                            </p>

                          </div>

                        </div>

                        <Badge variant={statusInfo.variant} className="gap-1">

                          <StatusIcon className="h-3 w-3" />

                          {t(`member.status.${member.status}`)}

                        </Badge>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          {t('common.viewProfile')}

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Nuevos Conversos Inactivos */}
      <Card ref={inactiveNewConvertsRef}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-amber-600" />
            {t('observations.inactiveConverts.sectionTitle')}
          </CardTitle>
          <CardDescription>
            {t('observations.inactiveConverts.sectionDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('observations.col.baptismDate')}</TableHead>
                  <TableHead>{t('observations.col.lastActivity')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : inactiveNewConverts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      {t('observations.inactiveConverts.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  inactiveNewConverts.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          {member.photoURL ? (
                            <OfflineImage
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={32}
                              height={32}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                              <Users className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <span>{member.firstName} {member.lastName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {member.baptismDate
                          ? format(member.baptismDate.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })
                          : t('common.notSpecifiedFeminine')}
                      </TableCell>
                      <TableCell>
                        {member.lastActiveDate
                          ? format(member.lastActiveDate.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })
                          : t('observations.never')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewProfile(member.id)}
                          title={t('common.viewProfile')}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-4">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))
            ) : inactiveNewConverts.length === 0 ? (
              <div className="text-center py-12">
                <UserX className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {t('observations.inactiveConverts.empty')}
                </p>
              </div>
            ) : (
              inactiveNewConverts.map((member) => (
                <Card key={member.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {member.photoURL ? (
                          <OfflineImage
                            src={member.photoURL}
                            alt={`${member.firstName} ${member.lastName}`}
                            width={40}
                            height={40}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                            <Users className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div>
                          <h3 className="font-semibold">{member.firstName} {member.lastName}</h3>
                          <p className="text-sm text-muted-foreground">
                            {t('observations.baptismLabel', {
                              date: member.baptismDate
                                ? format(member.baptismDate.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })
                                : t('common.notSpecifiedFeminine'),
                            })}
                          </p>
                        </div>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mb-3">
                      {t('observations.lastActivityLabel', {
                        date: member.lastActiveDate
                          ? format(member.lastActiveDate.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })
                          : t('observations.never'),
                      })}
                    </p>

                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewProfile(member.id)}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        {t('common.viewProfile')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sección Miembros Inactivos */}

      <Card ref={inactiveRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <UserX className="h-5 w-5 text-red-600" />

            {t('observations.inactive.sectionTitle')}

          </CardTitle>

          <CardDescription>

            {t('observations.inactive.sectionDescription')}

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>{t('common.name')}</TableHead>

                  <TableHead>{t('common.phone')}</TableHead>

                  <TableHead>{t('observations.col.birthDate')}</TableHead>

                  <TableHead>{t('observations.col.lastActivity')}</TableHead>

                  <TableHead className="text-right">{t('common.actions')}</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-28" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : inactiveMembers.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={5} className="h-24 text-center">

                      {t('observations.inactive.empty')}

                    </TableCell>

                  </TableRow>

                ) : (

                  inactiveMembers.map((member) => (

                    <TableRow key={member.id}>

                      <TableCell className="font-medium">

                        <div className="flex items-center gap-3">

                          {member.photoURL ? (

                            <OfflineImage
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={32}
                              height={32}
                              className="w-8 h-8 rounded-full object-cover"
                            />

                          ) : (

                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">

                              <Users className="h-4 w-4 text-muted-foreground" />

                            </div>

                          )}

                          <span>{member.firstName} {member.lastName}</span>

                        </div>

                      </TableCell>

                      <TableCell>{renderPhoneWithAge(member, t('common.notSpecified'), (age) => t('observations.ageSuffix', { age }))}</TableCell>

                      <TableCell>

                        {member.birthDate

                          ? format(member.birthDate.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })

                          : t('common.notSpecifiedFeminine')}

                      </TableCell>

                      <TableCell>

                        {member.lastActiveDate

                          ? format(member.lastActiveDate.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })

                          : t('observations.never')}

                      </TableCell>

                      <TableCell className="text-right">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                          title={t('common.viewProfile')}

                        >

                          <Eye className="h-4 w-4" />

                        </Button>

                      </TableCell>

                    </TableRow>

                  ))

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : inactiveMembers.length === 0 ? (

              <div className="text-center py-12">

                <UserX className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  {t('observations.inactive.empty')}

                </p>

              </div>

            ) : (

              inactiveMembers.map((member) => (

                <Card key={member.id}>

                  <CardContent className="pt-4">

                    <div className="flex items-start justify-between mb-3">

                      <div className="flex items-center gap-3">

                        {member.photoURL ? (

                          <OfflineImage
                            src={member.photoURL}
                            alt={`${member.firstName} ${member.lastName}`}
                            width={40}
                            height={40}
                            className="w-10 h-10 rounded-full object-cover"
                          />

                        ) : (

                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">

                            <Users className="h-5 w-5 text-muted-foreground" />

                          </div>

                        )}

                        <div>

                          <h3 className="font-semibold">{member.firstName} {member.lastName}</h3>

                          <p className="text-sm text-muted-foreground">

                            {renderPhoneWithAge(member, t('common.noPhone'), (age) => t('observations.ageSuffix', { age }))}

                          </p>

                        </div>

                      </div>

                    </div>






                    <p className="text-sm text-muted-foreground mb-3">

                      {t('observations.lastActivityLabel', {
                        date: member.lastActiveDate
                          ? format(member.lastActiveDate.toDate(), 'd MMM yyyy', { locale: getDateFnsLocale() })
                          : t('observations.never'),
                      })}

                    </p>



                    <div className="flex justify-end">

                      <Button

                        variant="outline"

                        size="sm"

                        onClick={() => handleViewProfile(member.id)}

                      >

                        <Eye className="mr-2 h-4 w-4" />

                        {t('common.viewProfile')}

                      </Button>

                    </div>

                  </CardContent>

                </Card>

              ))

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Compañerismos con familias menos activas */}

      <Card ref={familyFocusCompanionshipsRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <Users className="h-5 w-5 text-sky-600" />

            {t('observations.familyFocus.sectionTitle')}

          </CardTitle>

          <CardDescription>{t('observations.familyFocus.sectionDescription')}</CardDescription>

        </CardHeader>

        <CardContent>

          {/* Desktop Table */}

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>{t('observations.col.companionship')}</TableHead>

                  <TableHead>{t('observations.col.familiesAndStatus')}</TableHead>

                  <TableHead className="text-right">{t('common.actions')}</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-52" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : familyFocusCompanionships.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">

                      {t('observations.familyFocus.empty')}

                    </TableCell>

                  </TableRow>

                ) : (

                  familyFocusCompanionships.map((companionship) => (

                    <TableRow key={companionship.id}>

                      <TableCell className="font-medium">

                        {companionship.companions.map((c, i) => (

                          <div key={i}>

                            <span>{c}</span>

                            {i < companionship.companions.length - 1 && <hr className="my-1" />}

                          </div>

                        ))}

                      </TableCell>

                      <TableCell>

                        {companionship.flaggedFamilies.map((flagged, index) => (

                          <div key={flagged.family.name} className="space-y-1 py-1">

                            <p className="font-medium">{flagged.family.name}</p>

                            <div className="flex flex-wrap gap-1">

                              {flagged.members.map((member) => {

                                const statusInfo = statusConfig[member.status];

                                const StatusIcon = statusInfo.icon;

                                return (

                                  <Badge key={member.id} variant={statusInfo.variant} className="gap-1">

                                    <StatusIcon className="h-3 w-3" />

                                    {member.firstName} {member.lastName}

                                  </Badge>

                                );

                              })}

                            </div>

                            {index < companionship.flaggedFamilies.length - 1 && <div className="my-2 h-px bg-muted" />}

                          </div>

                        ))}

                      </TableCell>

                      <TableCell className="text-right">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => router.push(`/ministering/${companionship.id}`)}

                          title={t('observations.viewCompanionship')}

                        >

                          <Eye className="h-4 w-4" />

                        </Button>

                      </TableCell>

                    </TableRow>

                  ))

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)

            ) : familyFocusCompanionships.length === 0 ? (

              <div className="text-center py-12">

                <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">{t('observations.familyFocus.empty')}</p>

              </div>

            ) : (

              familyFocusCompanionships.map((companionship) => (

                <Card key={companionship.id}>

                  <CardContent className="pt-4 space-y-4">

                    <div>

                      <p className="text-sm font-medium mb-2">{t('observations.companionsLabel')}</p>

                      {companionship.companions.map((c, i) => (

                        <div key={i}>

                          <p>{c}</p>

                          {i < companionship.companions.length - 1 && <hr className="my-1" />}

                        </div>

                      ))}

                    </div>

                    <div>

                      <p className="text-sm font-medium mb-2">{t('observations.familiesToEncourage')}</p>

                      {companionship.flaggedFamilies.map((flagged) => (

                        <div key={flagged.family.name} className="mb-3 last:mb-0">

                          <p className="font-semibold">{flagged.family.name}</p>

                          <div className="mt-1 flex flex-wrap gap-1">

                            {flagged.members.map((member) => {

                              const statusInfo = statusConfig[member.status];

                              const StatusIcon = statusInfo.icon;

                              return (

                                <Badge key={member.id} variant={statusInfo.variant} className="gap-1">

                                  <StatusIcon className="h-3 w-3" />

                                  {member.firstName}

                                </Badge>

                              );

                            })}

                          </div>

                        </div>

                      ))}

                    </div>

                    <div className="flex justify-end">

                      <Button

                        variant="outline"

                        size="sm"

                        onClick={() => router.push(`/ministering/${companionship.id}`)}

                      >

                        <Eye className="mr-2 h-4 w-4" />{t('observations.viewMore')}

                      </Button>

                    </div>

                  </CardContent>

                </Card>

              ))

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Compañerías Problemáticas */}

      <Card ref={problematicCompanionshipsRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <Users className="h-5 w-5 text-orange-600" />

            {t('observations.problematic.sectionTitle')}

          </CardTitle>

          <CardDescription>

            {t('observations.problematic.sectionDescription')}

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>{t('observations.col.companions')}</TableHead>

                  <TableHead>{t('observations.col.assignedFamilies')}</TableHead>

                  <TableHead>{t('observations.col.companionStatus')}</TableHead>

                  <TableHead className="text-right">{t('common.actions')}</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : problematicCompanionships.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={4} className="h-24 text-center">

                      {t('observations.problematic.empty')}

                    </TableCell>

                  </TableRow>

                ) : (

                  problematicCompanionships.map((companionship) => {

                    const inactiveCompanions = companionship.companions.filter(companionName => {

                      const member = members.find(m =>

                        `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                      );

                      return member && (member.status === 'less_active' || member.status === 'inactive');

                    });



                    return (

                      <TableRow key={companionship.id}>

                        <TableCell className="font-medium">

                          {companionship.companions.map((c, i) => (

                            <div key={i}>

                              <span>{c}</span>

                              {i < companionship.companions.length - 1 && <hr className="my-1" />}

                            </div>

                          ))}

                        </TableCell>

                        <TableCell>

                          {companionship.families.map((f, i) => (

                            <div key={i}>

                              <span>{f.name}</span>

                              {i < companionship.families.length - 1 && <hr className="my-1" />}

                            </div>

                          ))}

                        </TableCell>

                        <TableCell>

                          <div className="flex flex-wrap gap-1">

                            {inactiveCompanions.map((companionName, i) => {

                              const member = members.find(m =>

                                `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                              );

                              if (!member) return null;

                              const statusInfo = statusConfig[member.status];

                              const StatusIcon = statusInfo.icon;

                              return (

                                <Badge key={i} variant={statusInfo.variant} className="gap-1">

                                  <StatusIcon className="h-3 w-3" />

                                  {t(`member.status.${member.status}`)}

                                </Badge>

                              );

                            })}

                          </div>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => router.push(`/ministering/${companionship.id}`)}

                            title={t('observations.viewCompanionshipButton')}

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : problematicCompanionships.length === 0 ? (

              <div className="text-center py-12">

                <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  {t('observations.problematic.empty')}

                </p>

              </div>

            ) : (

              problematicCompanionships.map((companionship) => {

                const inactiveCompanions = companionship.companions.filter(companionName => {

                  const member = members.find(m =>

                    `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                  );

                  return member && (member.status === 'less_active' || member.status === 'inactive');

                });



                return (

                  <Card key={companionship.id}>

                    <CardContent className="pt-4">

                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">{t('observations.companionsLabel')}</p>

                        {companionship.companions.map((c, i) => (

                          <div key={i}>

                            <p>{c}</p>

                            {i < companionship.companions.length - 1 && <hr className="my-1" />}

                          </div>

                        ))}

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">{t('observations.familiesLabel')}</p>

                        {companionship.families.map((f, i) => (

                          <div key={i}>

                            <p>{f.name}</p>

                            {i < companionship.families.length - 1 && <hr className="my-1" />}

                          </div>

                        ))}

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">{t('observations.companionStatusLabel')}</p>

                        <div className="flex flex-wrap gap-1">

                          {inactiveCompanions.map((companionName, i) => {

                            const member = members.find(m =>

                              `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                            );

                            if (!member) return null;

                            const statusInfo = statusConfig[member.status];

                            const StatusIcon = statusInfo.icon;

                            return (

                              <Badge key={i} variant={statusInfo.variant} className="gap-1">

                                <StatusIcon className="h-3 w-3" />

                                {t(`member.status.${member.status}`)}

                              </Badge>

                            );

                          })}

                        </div>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => router.push(`/ministering/${companionship.id}`)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          {t('observations.viewCompanionshipButton')}

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>



      <Dialog
        open={healthDialogOpen}
        onOpenChange={(open) => {
          setHealthDialogOpen(open);
          if (!open) {
            resetHealthForm();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditingHealthConcern ? t('observations.health.dialog.editTitle') : t('observations.health.dialog.addTitle')}
            </DialogTitle>
            <DialogDescription>
              {isEditingHealthConcern
                ? t('observations.health.dialog.editDescription')
                : t('observations.health.dialog.addDescription')}
            </DialogDescription>
          </DialogHeader>
          <Form {...healthForm}>
            <form onSubmit={healthForm.handleSubmit(handleHealthSubmit)} className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={photoPreview || undefined} alt={t('observations.health.photoAlt')} />
                  <AvatarFallback>{getInitials(watchFirstName, watchLastName)}</AvatarFallback>
                </Avatar>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={savingHealthConcern}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {photoPreview ? t('observations.health.changePhoto') : t('observations.health.uploadPhoto')}
                  </Button>
                  {photoPreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleRemovePhoto}
                      disabled={savingHealthConcern}
                    >
                      <X className="mr-2 h-4 w-4" />
                      {t('observations.health.removePhoto')}
                    </Button>
                  )}
                </div>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
                aria-label={t('observations.health.selectPhotoAria')}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={healthForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('observations.health.firstName')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t('observations.health.firstName')} disabled={savingHealthConcern} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={healthForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('observations.health.lastName')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t('observations.health.lastName')} disabled={savingHealthConcern} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={healthForm.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t('observations.health.address')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t('observations.health.addressPlaceholder')}
                          disabled={savingHealthConcern}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={healthForm.control}
                  name="observation"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t('observations.health.observation')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder={t('observations.health.observationPlaceholder')}
                          rows={4}
                          disabled={savingHealthConcern}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={healthForm.control}
                  name="helperIds"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t('observations.health.helpersLabel')}</FormLabel>
                      <FormControl>
                        <div className="space-y-3">
                          <Popover open={helperPickerOpen} onOpenChange={setHelperPickerOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className={cn('w-full justify-between', field.value.length === 0 && 'text-muted-foreground')}
                                disabled={loading || savingHealthConcern}
                              >
                                {field.value.length > 0
                                  ? t('observations.health.helpersSelected', { count: field.value.length })
                                  : t('observations.health.selectMembers')}
                                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="start"
                              sideOffset={8}
                              className="w-[min(320px,90vw)] max-h-[min(60vh,420px)] overflow-y-auto p-0"
                            >
                              {loading ? (
                                <div className="px-3 py-6 text-sm text-muted-foreground">{t('observations.health.loadingMembers')}</div>
                              ) : members.length === 0 ? (
                                <div className="px-3 py-6 text-sm text-muted-foreground">{t('observations.health.noMembersAvailable')}</div>
                              ) : (
                                <Command>
                                  <CommandInput placeholder={t('observations.health.searchMember')} />
                                  <CommandEmpty>{t('observations.health.noMembersFound')}</CommandEmpty>
                                  <CommandGroup>
                                    {members.map((member) => {
                                      const isSelected = field.value.includes(member.id);
                                      const statusInfo = statusConfig[member.status];
                                      return (
                                        <CommandItem
                                          key={member.id}
                                          value={`${member.firstName} ${member.lastName}`}
                                          onSelect={() => {
                                            toggleHelper(member.id);
                                            setHelperPickerOpen(true);
                                          }}
                                        >
                                          <div className="flex items-center gap-2">
                                            <Check className={cn('h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')} />
                                            <span className="flex-1">{member.firstName} {member.lastName}</span>
                                            <Badge variant={statusInfo.variant} className="text-[10px]">
                                              {t(`member.status.${member.status}`)}
                                            </Badge>
                                          </div>
                                        </CommandItem>
                                      );
                                    })}
                                  </CommandGroup>
                                </Command>
                              )}
                            </PopoverContent>
                          </Popover>
                          <div className="flex flex-wrap gap-2">
                            {field.value.length === 0 ? (
                              <span className="text-sm text-muted-foreground">
                                {t('observations.health.selectAtLeastOne')}
                              </span>
                            ) : (
                              field.value.map((helperId, index) => {
                                const helper = membersById.get(helperId);
                                const helperName = helper
                                  ? `${helper.firstName} ${helper.lastName}`
                                  : t('observations.health.memberUnregistered');
                                return (
                                  <Badge
                                    key={`${helperId}-${index}`}
                                    variant="secondary"
                                    className="flex items-center gap-1"
                                  >
                                    {helperName}
                                    <button
                                      type="button"
                                      onClick={() => toggleHelper(helperId)}
                                      className="rounded-full p-0.5 hover:bg-muted"
                                      aria-label={t('observations.health.removeHelperAria', { name: helperName })}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </Badge>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setHealthDialogOpen(false);
                    resetHealthForm();
                  }}
                  disabled={savingHealthConcern}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={savingHealthConcern}>
                  {savingHealthConcern ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isEditingHealthConcern ? t('common.updating') : t('common.saving')}
                    </>
                  ) : (
                    isEditingHealthConcern ? t('observations.health.updateRecord') : t('observations.health.saveRecord')
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {showScrollTop && (

        <Button

          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}

          className="fixed bottom-4 right-4 z-50 rounded-full p-3 shadow-lg bg-primary hover:bg-primary/90"

          size="icon"

          title={t('observations.scrollTop')}

        >

          <ChevronUp className="h-5 w-5" />

        </Button>

      )}

    </section>

  );

}
