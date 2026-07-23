/**
 * Clasificación inteligente del miembro para etiquetas de portada:
 * - futuro miembro (bautismo programado, aún no bautizado)
 * - converso reciente (bautismo en últimos 24 meses)
 * - bautizado (miembro con bautismo antiguo)
 * - bautismo programado vencido / no bautizado
 */

import type { Member, Ordinance } from '@/lib/types';
import {
  getMemberBaptismDate,
  isRecentConvertMember,
} from '@/lib/converts-from-members';

export type MemberLifecycleKind =
  | 'future_member'
  | 'recent_convert'
  | 'baptized'
  | 'scheduled_baptism'
  | 'not_baptized';

type LifecycleMember = Pick<Member, 'baptismDate' | 'status' | 'ordinances'>;

export function hasBaptismOrdinance(
  ordinances?: Ordinance[] | null
): boolean {
  return ordinances?.includes('baptism') ?? false;
}

/**
 * Devuelve el tipo de ciclo de vida del miembro para la etiqueta de portada.
 * Prioridad: futuro miembro → converso reciente → bautizado → programado → no bautizado.
 *
 * "Converso" usa la misma regla que la página de Conversos (baptismDate en 24 meses),
 * para que no diga "Bautizado" en Miembros mientras en Conversos sí aparece.
 */
export function getMemberLifecycleKind(
  member: LifecycleMember | null | undefined,
  now = new Date()
): MemberLifecycleKind {
  if (!member) return 'not_baptized';

  const hasOrdinance = hasBaptismOrdinance(member.ordinances);
  const baptismDate = getMemberBaptismDate(member);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (!hasOrdinance && baptismDate) {
    const day = new Date(baptismDate);
    day.setHours(0, 0, 0, 0);
    // Bautismo futuro o de hoy sin ordenanza → futuro miembro
    if (day >= today) return 'future_member';
  }

  // Misma fuente de verdad que /converts: fecha de bautismo en últimos 24 meses
  if (isRecentConvertMember(member, now)) {
    return 'recent_convert';
  }

  if (hasOrdinance) return 'baptized';

  if (baptismDate) return 'scheduled_baptism';

  return 'not_baptized';
}

/** Clave i18n de la etiqueta de portada según el ciclo de vida. */
export function getMemberLifecycleBadgeKey(
  kind: MemberLifecycleKind
): string {
  switch (kind) {
    case 'future_member':
      return 'members.badge.futureMember';
    case 'recent_convert':
      return 'members.badge.recentConvert';
    case 'baptized':
      return 'members.badge.baptized';
    case 'scheduled_baptism':
      return 'members.badge.scheduledBaptism';
    case 'not_baptized':
    default:
      return 'members.badge.notBaptized';
  }
}

/** Variante visual del Badge de shadcn según el ciclo de vida. */
export function getMemberLifecycleBadgeVariant(
  kind: MemberLifecycleKind
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (kind) {
    case 'future_member':
      return 'secondary';
    case 'recent_convert':
      return 'default';
    case 'baptized':
      return 'default';
    case 'scheduled_baptism':
      return 'secondary';
    case 'not_baptized':
    default:
      return 'outline';
  }
}

export type DigitalAccountCoverBadge = {
  /** Cuenta LDS / Church Account */
  showLds: boolean;
  hasLds: boolean;
  /** Cuenta FamilySearch */
  showFamilySearch: boolean;
  hasFamilySearch: boolean;
};

/**
 * Etiquetas LDS/FS en la portada: siempre visibles.
 * - Con cuenta → LDS ✓ / FS ✓
 * - Sin cuenta → Sin LDS / Sin FS (seguimiento digital en todos los casos)
 * El tipo de bautismo (converso / futuro / bautizado) va aparte y es dinámico.
 */
export function getDigitalAccountCoverBadges(
  member:
    | Pick<Member, 'hasLdsAccount' | 'hasFamilySearchAccount'>
    | null
    | undefined,
  _kind?: MemberLifecycleKind
): DigitalAccountCoverBadge {
  const hasLds = member?.hasLdsAccount === true;
  const hasFamilySearch = member?.hasFamilySearchAccount === true;

  return {
    hasLds,
    hasFamilySearch,
    showLds: true,
    showFamilySearch: true,
  };
}
