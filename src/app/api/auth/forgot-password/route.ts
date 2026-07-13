import { NextRequest, NextResponse } from 'next/server';
import { authAdmin } from '@/lib/firebase-admin';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * Verifica si un correo existe en Firebase Auth antes de permitir el envío
 * del enlace de recuperación. Firebase client ya no devuelve auth/user-not-found
 * (protección de enumeración), así que la validación se hace con Admin SDK.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'auth');
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const email =
      body && typeof body === 'object' && typeof (body as { email?: unknown }).email === 'string'
        ? (body as { email: string }).email.trim().toLowerCase()
        : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'invalid-email', message: 'A valid email is required.' },
        { status: 400 }
      );
    }

    try {
      await authAdmin.getUserByEmail(email);
      return NextResponse.json({ exists: true });
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';

      if (code === 'auth/user-not-found') {
        return NextResponse.json(
          { error: 'user-not-found', message: 'No user found with this email address.', exists: false },
          { status: 404 }
        );
      }

      console.error('[forgot-password] Error checking user:', error);
      return NextResponse.json(
        { error: 'unexpected', message: 'An unexpected error occurred.' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[forgot-password] Unexpected error:', error);
    return NextResponse.json(
      { error: 'unexpected', message: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}
