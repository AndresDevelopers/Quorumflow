import type { Member } from '@/lib/types';

/**
 * Normalize values so Firestore timestamps / nested objects compare stably.
 */
function stableValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== 'object') return value;

  const v = value as Record<string, unknown> & {
    toMillis?: () => number;
    seconds?: number;
    nanoseconds?: number;
  };

  // Firestore Timestamp (client SDK)
  if (typeof v.toMillis === 'function') {
    try {
      return v.toMillis();
    } catch {
      // fall through
    }
  }

  // Serialized timestamp shape
  if (typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') {
    return v.seconds * 1000 + Math.floor(v.nanoseconds / 1e6);
  }

  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  const keys = Object.keys(v).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (v[key] === undefined) continue;
    out[key] = stableValue(v[key]);
  }
  return out;
}

/** True when two members represent the same persisted data. */
export function membersEqual(a: Member, b: Member): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

export interface MembersMergeResult {
  /** Merged list (server order preferred; unchanged entries keep cached object). */
  list: Member[];
  /** True if anything was added, updated, or removed vs the previous cache. */
  hasChanges: boolean;
  addedIds: string[];
  updatedIds: string[];
  removedIds: string[];
}

/**
 * Merge server members into local cache without wiping the whole store.
 * - New server members are added
 * - Changed members replace only that entry
 * - Unchanged members keep the cached copy
 * - Members missing on the server are removed from the result
 * - If nothing differs, hasChanges is false (caller should leave cache as-is)
 */
export function mergeMembersCache(
  cached: Member[],
  server: Member[]
): MembersMergeResult {
  const cachedById = new Map(cached.map((m) => [m.id, m]));
  const serverIds = new Set<string>();
  const list: Member[] = [];
  const addedIds: string[] = [];
  const updatedIds: string[] = [];

  for (const serverMember of server) {
    serverIds.add(serverMember.id);
    const prev = cachedById.get(serverMember.id);
    if (!prev) {
      list.push(serverMember);
      addedIds.push(serverMember.id);
      continue;
    }
    if (!membersEqual(prev, serverMember)) {
      list.push(serverMember);
      updatedIds.push(serverMember.id);
      continue;
    }
    // Nothing new for this member — keep cached entry
    list.push(prev);
  }

  const removedIds: string[] = [];
  for (const id of cachedById.keys()) {
    if (!serverIds.has(id)) {
      removedIds.push(id);
    }
  }

  const hasChanges =
    addedIds.length > 0 || updatedIds.length > 0 || removedIds.length > 0;

  // If no structural/content changes, return the original cache array reference
  // so callers can skip rewrites and avoid unnecessary re-renders.
  if (!hasChanges) {
    return {
      list: cached,
      hasChanges: false,
      addedIds,
      updatedIds,
      removedIds,
    };
  }

  return { list, hasChanges, addedIds, updatedIds, removedIds };
}
