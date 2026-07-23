import { Timestamp } from 'firebase/firestore';
import {
  getMemberLifecycleKind,
  getMemberLifecycleBadgeKey,
  hasBaptismOrdinance,
  getDigitalAccountCoverBadges,
} from '@/lib/member-lifecycle';
import type { Member } from '@/lib/types';

const base = {
  id: 'm1',
  firstName: 'Ana',
  lastName: 'Lopez',
  status: 'active' as const,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  createdBy: 'test',
};

function member(partial: Partial<Member>): Member {
  return { ...base, ...partial } as Member;
}

function daysFromNow(days: number): Timestamp {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return Timestamp.fromDate(d);
}

describe('hasBaptismOrdinance', () => {
  it('detects baptism ordinance', () => {
    expect(hasBaptismOrdinance(['baptism', 'confirmation'])).toBe(true);
    expect(hasBaptismOrdinance(['confirmation'])).toBe(false);
    expect(hasBaptismOrdinance(undefined)).toBe(false);
  });
});

describe('getMemberLifecycleKind', () => {
  it('marks future member when baptism is scheduled and not baptized', () => {
    const m = member({
      ordinances: [],
      baptismDate: daysFromNow(14),
    });
    expect(getMemberLifecycleKind(m)).toBe('future_member');
  });

  it('marks scheduled baptism when date is past and older than convert window without ordinance', () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 5);
    const m = member({
      ordinances: [],
      baptismDate: Timestamp.fromDate(old),
    });
    expect(getMemberLifecycleKind(m)).toBe('scheduled_baptism');
  });

  it('marks not baptized when no date and no ordinance', () => {
    const m = member({ ordinances: [], baptismDate: undefined });
    expect(getMemberLifecycleKind(m)).toBe('not_baptized');
  });

  it('marks recent convert when baptized within last 24 months', () => {
    const m = member({
      ordinances: ['baptism'],
      baptismDate: daysFromNow(-30),
    });
    expect(getMemberLifecycleKind(m)).toBe('recent_convert');
  });

  it('marks recent convert when baptismDate is a plain {seconds} object (localStorage cache)', () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    const m = member({
      ordinances: ['baptism'],
      // Simula Timestamp tras JSON.parse del caché de miembros
      baptismDate: { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 } as unknown as Timestamp,
    });
    expect(getMemberLifecycleKind(m)).toBe('recent_convert');
  });

  it('marks recent convert by baptismDate even if ordinance list is empty (same as converts page)', () => {
    const m = member({
      ordinances: [],
      baptismDate: daysFromNow(-60),
    });
    expect(getMemberLifecycleKind(m)).toBe('recent_convert');
  });

  it('marks baptized when ordinance is older than 24 months', () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 5);
    const m = member({
      ordinances: ['baptism', 'confirmation'],
      baptismDate: Timestamp.fromDate(old),
    });
    expect(getMemberLifecycleKind(m)).toBe('baptized');
  });
});

describe('getMemberLifecycleBadgeKey', () => {
  it('maps kinds to i18n keys', () => {
    expect(getMemberLifecycleBadgeKey('future_member')).toBe('members.badge.futureMember');
    expect(getMemberLifecycleBadgeKey('recent_convert')).toBe('members.badge.recentConvert');
    expect(getMemberLifecycleBadgeKey('baptized')).toBe('members.badge.baptized');
  });
});

describe('digital account cover badges', () => {
  it('always shows LDS/FS status including missing accounts', () => {
    const missing = getDigitalAccountCoverBadges(
      { hasLdsAccount: false, hasFamilySearchAccount: false },
      'baptized'
    );
    expect(missing.showLds).toBe(true);
    expect(missing.hasLds).toBe(false);
    expect(missing.showFamilySearch).toBe(true);
    expect(missing.hasFamilySearch).toBe(false);

    const withAccounts = getDigitalAccountCoverBadges(
      { hasLdsAccount: true, hasFamilySearchAccount: true },
      'baptized'
    );
    expect(withAccounts.hasLds).toBe(true);
    expect(withAccounts.hasFamilySearch).toBe(true);
  });
});
