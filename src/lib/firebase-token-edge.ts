/**
 * Edge-safe verification of Firebase ID tokens (JWKS).
 * Used by proxy (request gate) — no firebase-admin on the Edge/Node runtime.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  )
);

export type VerifiedFirebaseToken = JWTPayload & {
  sub: string;
  user_id?: string;
  email?: string;
};

export async function verifyFirebaseIdTokenEdge(
  token: string
): Promise<VerifiedFirebaseToken> {
  // Prefer public client project id (must match the token audience). Fall back to
  // common server aliases so a missing NEXT_PUBLIC_ var does not brick production.
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    '';
  if (!projectId) {
    throw new Error(
      'Firebase project id is not configured (NEXT_PUBLIC_FIREBASE_PROJECT_ID)'
    );
  }

  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) {
    throw new Error('Token missing subject');
  }

  return payload as VerifiedFirebaseToken;
}
