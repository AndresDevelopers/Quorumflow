
import { query, where, limit, Timestamp, orderBy } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';
import {
  futureMembersCollection,
  ministeringCollection,
  activitiesCollection,
  servicesCollection,
  membersCollection,
  annotationsCollection
} from '@/lib/collections';
import type { Companionship, Activity, Service, Member } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';
import { buildActivityOverview } from '@/lib/activity-overview';
import { membersToRecentConverts } from '@/lib/converts-from-members';
import { addDays, format, isAfter, isBefore } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { offlineDataKey, withOfflineData } from '@/lib/offline-data-store';
import logger from '@/lib/logger';

/** Shared early-warning when a single-barrio members query saturates limit(500). */
function warnIfMembersLimitHit(barrioOrg: string, queryName: string, size: number) {
  if (size !== 500) return;
  logger.warn({
    message: 'Member query hit limit(500); barrio may be approaching the hard cap',
    barrioOrg,
    query: queryName,
    size,
  });
}

function mapMember(docId: string, memberData: Record<string, any>): Member {
  return {
    id: docId,
    ...memberData,
    status: normalizeMemberStatus(memberData.status),
  } as Member;
}

/** Derive future-baptism candidates from an already-loaded members list (no extra read). */
export function deriveFutureMembers(members: Member[]): Member[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return members
    .filter(member => {
      if (member.status === 'deceased') return false;
      const isBaptized = member.ordinances?.includes('baptism') ?? false;
      // Include baptisms scheduled for today or later (compare at start of day)
      const baptismDay = member.baptismDate
        ? (() => {
            const d = member.baptismDate.toDate();
            d.setHours(0, 0, 0, 0);
            return d;
          })()
        : null;
      const hasFutureBaptism = baptismDay !== null && baptismDay >= today;
      return !isBaptized && hasFutureBaptism;
    })
    .sort((a, b) => {
      if (!a.baptismDate || !b.baptismDate) return 0;
      return a.baptismDate.toMillis() - b.baptismDate.toMillis();
    });
}

export async function getFutureMembers(barrioOrg: string): Promise<Member[]> {
  // limit(500): assumes single-barrio scope via barrioOrg. Revisit if multi-barrio/stake views are added.
  const snapshot = await getDocs(query(membersCollection, where('barrioOrg', '==', barrioOrg), limit(500)));
  warnIfMembersLimitHit(barrioOrg, 'getFutureMembers', snapshot.size);
  const members = snapshot.docs.map(doc => mapMember(doc.id, doc.data()));
  return deriveFutureMembers(members);
}

/**
 * Single-pass dashboard load: one members read + parallel scoped queries.
 * Avoids re-fetching c_miembros 3–5 times per home visit.
 */
export async function getDashboardData(barrioOrg: string) {
  return withOfflineData(offlineDataKey('dashboard', barrioOrg), async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysFromNow = addDays(today, 7);
    const fourteenDaysFromNow = addDays(today, 14);

    const [
      membersSnapshot,
      ministeringSnapshot,
      councilAnnotationsSnapshot,
      servicesSnapshot,
      upcomingBaptismsSnapshot,
      activitiesSnapshot,
    ] = await Promise.all([
      // Single members load for converts-from-members, future, less_active, status cards.
      // limit(500): assumes single-barrio scope via barrioOrg. Revisit if multi-barrio/stake views are added.
      getDocs(query(membersCollection, where('barrioOrg', '==', barrioOrg), limit(500))),
      getDocs(query(ministeringCollection, where('barrioOrg', '==', barrioOrg))),
      getDocs(query(
        annotationsCollection,
        where('barrioOrg', '==', barrioOrg),
        where('isResolved', '==', false)
      )),
      getDocs(query(
        servicesCollection,
        where('barrioOrg', '==', barrioOrg),
        where('date', '>=', Timestamp.fromDate(today))
      )),
      getDocs(query(
        futureMembersCollection,
        where('barrioOrg', '==', barrioOrg),
        where('baptismDate', '>=', Timestamp.fromDate(today)),
        where('baptismDate', '<=', Timestamp.fromDate(sevenDaysFromNow))
      )),
      // Only next 14 days of activities (not full history)
      getDocs(query(
        activitiesCollection,
        where('barrioOrg', '==', barrioOrg),
        where('date', '>=', Timestamp.fromDate(today)),
        where('date', '<=', Timestamp.fromDate(fourteenDaysFromNow)),
        orderBy('date', 'asc')
      )),
    ]);

    warnIfMembersLimitHit(barrioOrg, 'getDashboardData', membersSnapshot.size);
    const members = membersSnapshot.docs.map(doc => mapMember(doc.id, doc.data()));
    const membersAlive = members.filter(m => m.status !== 'deceased');

    // 1. Conversos recientes = solo miembros con baptismDate en los últimos 24 meses
    const convertsCount = membersToRecentConverts(membersAlive).length;

    // 2. Future members from same members array
    const futureMembersCount = deriveFutureMembers(members).length;

    // 3. Ministering urgent
    const companionships = ministeringSnapshot.docs.map(doc => doc.data() as Companionship);
    const urgentNeedsCount = companionships.flatMap(c => c.families).filter(f => f.isUrgent).length;

    // 4. Council actions
    const councilAnnotationsCount = councilAnnotationsSnapshot.size;

    const services = servicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Service));
    const servicesNotNotifiedCount = services.filter(service =>
      service.councilNotified === false || service.councilNotified === undefined
    ).length;

    const pendingCouncilConverts = membersToRecentConverts(membersAlive)
      .filter((c) => !c.councilCompleted)
      .length;

    const upcomingBaptismsCount = upcomingBaptismsSnapshot.size;

    const upcomingActivitiesCount = activitiesSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Activity))
      .filter(activity => {
        const activityDate = activity.date.toDate();
        return isAfter(activityDate, today) && isBefore(activityDate, fourteenDaysFromNow);
      }).length;

    const lessActiveMembersNeedingCouncilCount = membersAlive
      .filter(m => m.status === 'less_active' && !m.councilCompleted)
      .length;

    const councilActionsCount =
      councilAnnotationsCount +
      servicesNotNotifiedCount +
      pendingCouncilConverts +
      upcomingBaptismsCount +
      upcomingActivitiesCount +
      urgentNeedsCount +
      lessActiveMembersNeedingCouncilCount;

    // Status breakdown for dashboard cards (from same members array)
    const active = membersAlive.filter(m => m.status === 'active');
    const lessActive = membersAlive.filter(m => m.status === 'less_active');
    const inactive = membersAlive.filter(m => m.status === 'inactive');

    // Deceased needing temple work (same list, filter in memory)
    const allTempleOrdinances = [
      'baptism',
      'confirmation',
      'initiatory',
      'endowment',
      'sealed_to_father',
      'sealed_to_mother',
      'sealed_to_spouse',
    ] as const;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const deceasedMembers = members
      .filter(m => m.status === 'deceased')
      .filter(member => {
        const ordinances = [
          ...(member.ordinances || []),
          ...((member as any).templeOrdinances || []),
        ];
        const unique = [...new Set(ordinances)];
        const allComplete = allTempleOrdinances.every(ord => unique.includes(ord));
        if (allComplete) {
          const completedAt = member.templeWorkCompletedAt?.toDate?.()
            ?? (member.templeWorkCompletedAt ? new Date(member.templeWorkCompletedAt as unknown as string) : null);
          if (completedAt && !Number.isNaN(completedAt.getTime())) return completedAt > sevenDaysAgo;
          return true;
        }
        return true;
      })
      .sort((a, b) => a.lastName.localeCompare(b.lastName));

    return {
      convertsCount,
      futureMembersCount,
      councilActionsCount,
      membersByStatus: {
        active,
        lessActive,
        inactive,
        total: membersAlive.length,
      },
      deceasedMembers,
    };
  });
}

export async function getMembersByStatus(barrioOrg: string) {
  // limit(500): assumes single-barrio scope via barrioOrg. Revisit if multi-barrio/stake views are added.
  const membersSnapshot = await getDocs(query(
    membersCollection,
    where('barrioOrg', '==', barrioOrg),
    limit(500)
  ));
  warnIfMembersLimitHit(barrioOrg, 'getMembersByStatus', membersSnapshot.size);
  const members = membersSnapshot.docs
    .map(doc => mapMember(doc.id, doc.data()))
    .filter(member => member.status !== 'deceased');

  return {
    active: members.filter(m => m.status === 'active'),
    lessActive: members.filter(m => m.status === 'less_active'),
    inactive: members.filter(m => m.status === 'inactive'),
    total: members.length
  };
}

export async function getActivityOverviewData(barrioOrg: string) {
  return withOfflineData(offlineDataKey('activity-overview', barrioOrg), async () => {
    // Only current year — avoids loading full activity history
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const activitiesSnapshot = await getDocs(query(
      activitiesCollection,
      where('barrioOrg', '==', barrioOrg),
      where('date', '>=', Timestamp.fromDate(yearStart)),
      orderBy('date', 'asc')
    ));
    const activities = activitiesSnapshot.docs.map((doc) => {
      const activity = doc.data() as Activity;

      return {
        title: activity.title,
        date: activity.date.toDate(),
      };
    });

    return buildActivityOverview(activities);
  });
}


export async function getActivityChartData(barrioOrg: string) {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const activitiesSnapshot = await getDocs(query(
    activitiesCollection,
    where('barrioOrg', '==', barrioOrg),
    where('date', '>=', Timestamp.fromDate(yearStart)),
    orderBy('date', 'asc')
  ));
  const activities = activitiesSnapshot.docs.map(doc => doc.data() as Activity);

  const monthlyTotals: { [key: string]: number } = {
    Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0,
    Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0,
  };

  const currentYear = new Date().getFullYear();

  activities.forEach(activity => {
    const activityDate = activity.date.toDate();
    if (activityDate.getFullYear() === currentYear) {
      const month = format(activityDate, 'MMM', { locale: getDateFnsLocale() });
      const monthKey = month.charAt(0).toUpperCase() + month.slice(1).replace('.', '');
      if (Object.prototype.hasOwnProperty.call(monthlyTotals, monthKey)) {
        monthlyTotals[monthKey] += 1;
      }
    }
  });

  const chartData = Object.entries(monthlyTotals).map(([name, total]) => ({
    name: name,
    total: total,
  }));

  const standardOrder = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthNameMapping: { [key: string]: string } = {
    Jan: "Ene", Aug: "Ago", Apr: "Abr", Dec: "Dic"
  };

  const sortedChartData = standardOrder.map(monthName => {
    const englishKey = Object.keys(monthNameMapping).find(key => monthNameMapping[key] === monthName) || monthName;
    const dataEntry = chartData.find(d => d.name === englishKey || d.name === monthName);
    return {
      name: monthName,
      total: dataEntry ? dataEntry.total : 0,
    }
  });

  return sortedChartData;
}
