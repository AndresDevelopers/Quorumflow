import '@/test-support/page-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test-support/render';
import { mockRouter } from '@/test-support/page-mocks';

import NoPermissionPage from '@/app/no-permission/page';
import OfflineFallbackPage from '@/app/~offline/page';
import DonatePage from '@/app/(main)/donate/page';

describe('shell / public-ish pages smoke', () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
  });

  it('renders no-permission page', () => {
    renderWithProviders(<NoPermissionPage />);
    // Spanish default locale keys resolve to real strings
    expect(screen.getByRole('heading')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders offline fallback page', () => {
    renderWithProviders(<OfflineFallbackPage />);
    expect(screen.getByRole('heading', { name: /sin conexión/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /login/i })).toBeInTheDocument();
  });

  it('renders donate page (loading or content)', async () => {
    renderWithProviders(<DonatePage />);
    await waitFor(
      () => {
        expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
  });
});
