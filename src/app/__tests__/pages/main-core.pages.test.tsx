import '@/test-support/page-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test-support/render';
import { mockRouter } from '@/test-support/page-mocks';

import DashboardPage from '@/app/(main)/page';
import BirthdaysPage from '@/app/(main)/birthdays/page';
import FamilySearchPage from '@/app/(main)/family-search/page';
import ProfilePage from '@/app/(main)/profile/page';
import ConvertsPage from '@/app/(main)/converts/page';

async function expectPageMounted() {
  await waitFor(
    () => {
      expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    },
    { timeout: 5000 },
  );
}

describe('main core pages smoke', () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
  });

  it('renders dashboard', async () => {
    renderWithProviders(<DashboardPage />);
    await expectPageMounted();
  });

  it('renders birthdays page', async () => {
    renderWithProviders(<BirthdaysPage />);
    await expectPageMounted();
  });

  it('renders family-search page', async () => {
    renderWithProviders(<FamilySearchPage />);
    await expectPageMounted();
  });

  it('renders profile page', async () => {
    renderWithProviders(<ProfilePage />);
    await expectPageMounted();
  });

  it('renders converts page', async () => {
    renderWithProviders(<ConvertsPage />);
    await expectPageMounted();
  });
});
