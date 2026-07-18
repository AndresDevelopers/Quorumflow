import '@/test-support/page-mocks';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, waitFor } from '@/test-support/render';
import { mockRouter } from '@/test-support/page-mocks';

import MembersPage from '@/app/(main)/members/page';
import MinisteringPage from '@/app/(main)/ministering/page';
import ServicePage from '@/app/(main)/service/page';
import ChurchChatPage from '@/app/(main)/church-chat/page';
import CouncilPage from '@/app/(main)/council/page';
import MissionaryWorkPage from '@/app/(main)/missionary-work/page';
import SettingsPage from '@/app/(main)/settings/page';
import ObservationsPage from '@/app/(main)/observations/page';
import ActivitiesPage from '@/app/(main)/reports/activities/page';
import AdminPage from '@/app/(main)/admin/page';

// Heavy / side-effect modules often imported by large pages
vi.mock('@/components/shared/voice-annotations', () => ({
  VoiceAnnotations: () => null,
}));

vi.mock('@/components/shared/disclaimer-popup', () => ({
  DisclaimerPopup: () => null,
}));

vi.mock('@/components/offline-image', () => ({
  OfflineImage: ({ alt }: { alt?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ''} src="" />
  ),
}));

async function expectPageMounted() {
  await waitFor(
    () => {
      expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    },
    { timeout: 8000 },
  );
}

describe('main more pages smoke', () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
  });

  it('renders members page', async () => {
    renderWithProviders(<MembersPage />);
    await expectPageMounted();
  }, 15000);

  it('renders ministering page', async () => {
    renderWithProviders(<MinisteringPage />);
    await expectPageMounted();
  }, 15000);

  it('renders service page', async () => {
    renderWithProviders(<ServicePage />);
    await expectPageMounted();
  }, 15000);

  it('renders church-chat page', async () => {
    renderWithProviders(<ChurchChatPage />);
    await expectPageMounted();
  }, 15000);

  it('renders council page', async () => {
    renderWithProviders(<CouncilPage />);
    await expectPageMounted();
  }, 15000);

  it('renders missionary-work page', async () => {
    renderWithProviders(<MissionaryWorkPage />);
    await expectPageMounted();
  }, 15000);

  it('renders settings page', async () => {
    renderWithProviders(<SettingsPage />);
    await expectPageMounted();
  }, 15000);

  it('renders observations page', async () => {
    renderWithProviders(<ObservationsPage />);
    await expectPageMounted();
  }, 15000);

  it('renders reports/activities page', async () => {
    renderWithProviders(<ActivitiesPage />);
    await expectPageMounted();
  }, 15000);

  it('renders admin page', async () => {
    renderWithProviders(<AdminPage />);
    await expectPageMounted();
  }, 15000);
});
