import '@/test-support/page-mocks';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test-support/render';
import { mockRouter } from '@/test-support/page-mocks';

import LoginPage from '@/app/(auth)/login/page';
import RegisterPage from '@/app/(auth)/register/page';
import ForgotPasswordPage from '@/app/(auth)/forgot-password/page';

// Auth pages call ensureServerSession / hardNavigate — keep them inert
vi.mock('@/lib/auth-session-client', () => ({
  canAttemptAuthRedirect: () => true,
  ensureServerSession: vi.fn(async () => false),
  hardNavigate: vi.fn(),
  clearAuthRedirectGuard: vi.fn(),
  syncServerSession: vi.fn(async () => true),
}));

describe('auth pages smoke', () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
  });

  it('renders login form fields', async () => {
    renderWithProviders(<LoginPage />);
    // Wait until session restore finishes and form appears
    expect(
      await screen.findByText(/login|iniciar sesión/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5000 },
    );
  });

  it('renders register page shell', async () => {
    renderWithProviders(<RegisterPage />);
    await waitFor(() => {
      expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
    });
    expect(document.querySelector('form') || screen.queryAllByRole('textbox').length > 0).toBeTruthy();
  });

  it('renders forgot-password page shell', async () => {
    renderWithProviders(<ForgotPasswordPage />);
    await waitFor(() => {
      expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
    });
    expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(1);
  });
});
