import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { firestoreAdmin } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import logger from '@/lib/logger';
import type { Member } from '@/lib/types';

function coerceToTimestamp(value: unknown): Timestamp | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : Timestamp.fromDate(value);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : Timestamp.fromDate(date);
  }
  if (typeof value === 'object' && value) {
    const maybeValue: any = value;
    if (typeof maybeValue.toDate === 'function') {
      const date = maybeValue.toDate();
      if (date instanceof Date && !isNaN(date.getTime())) {
        return Timestamp.fromDate(date);
      }
    }
    const seconds = maybeValue.seconds ?? maybeValue._seconds;
    const nanoseconds = maybeValue.nanoseconds ?? maybeValue._nanoseconds;
    if (typeof seconds === 'number') {
      const millis =
        seconds * 1000 +
        (typeof nanoseconds === 'number' ? Math.floor(nanoseconds / 1_000_000) : 0);
      return Timestamp.fromMillis(millis);
    }
  }
  return undefined;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let data: any = null;
  const { id } = await params;
  try {
    try {
      data = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    if (!id || id.trim() === '') {
      return NextResponse.json(
        { error: 'Invalid member ID' },
        { status: 400 }
      );
    }

    // Convert date strings to Admin Timestamps
    const updateData: Record<string, unknown> = {
      ...data,
      updatedAt: Timestamp.now(),
    };
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.createdBy;

    if ('birthDate' in data) {
      const bd = coerceToTimestamp(data.birthDate);
      updateData.birthDate = bd instanceof Timestamp ? bd : null;
    }
    if ('baptismDate' in data) {
      const bap = coerceToTimestamp(data.baptismDate);
      updateData.baptismDate = bap instanceof Timestamp ? bap : null;
    }

    // Admin SDK — bypasses Firestore rules
    await firestoreAdmin.collection('c_miembros').doc(id).update(updateData);

    revalidateTag('members', 'default');

    const response = NextResponse.json({ success: true });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update member';
    return NextResponse.json(
      { error: message, memberId: id },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Check if member has photo to delete from storage
    let photoURL: string | undefined;
    try {
      const doc = await firestoreAdmin.collection('c_miembros').doc(id).get();
      if (doc.exists) {
        photoURL = (doc.data() as any)?.photoURL;
      }
    } catch {
      // Continue even if lookup fails
    }

    // Delete photo from Firebase Storage if exists (via Admin SDK)
    if (photoURL) {
      try {
        const { getAdminBucket } = await import('@/lib/firebase-admin');
        const bucket = getAdminBucket();
        // photoURL contains full Firebase Storage download URL, extract path
        // e.g. https://firebasestorage.googleapis.com/v0/b/PROJECT/o/path%2Ffile?alt=media
        const urlPath = photoURL.split('/o/')[1]?.split('?')[0];
        if (urlPath) {
          const filePath = decodeURIComponent(urlPath);
          await bucket.file(filePath).delete().catch(() => {});
        }
      } catch {
        // Non-critical, continue
      }
    }

    // Admin SDK — bypasses Firestore rules
    await firestoreAdmin.collection('c_miembros').doc(id).delete();

    revalidateTag('members', 'default');

    const response = NextResponse.json({ success: true });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    logger.error({ error, message: 'Error deleting member', memberId: id });
    const message = error instanceof Error ? error.message : 'Failed to delete member';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
