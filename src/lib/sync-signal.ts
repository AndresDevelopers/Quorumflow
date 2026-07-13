/** Shared helpers for Cloud Function → client data-sync signals */

export const SYNC_SIGNALS_COLLECTION = 'c_sync_signals';

/** Must match functions/src/modules/data-sync-publisher.ts encodeBarrioOrgDocId */
export function encodeBarrioOrgDocId(barrioOrg: string): string {
  return encodeURIComponent(barrioOrg.trim()).replace(/%/g, '_');
}

export type SyncSignalPayload = {
  barrioOrg?: string;
  version?: number;
  lastCollection?: string;
  lastDocId?: string;
  lastChangeType?: string;
  updatedAtMs?: number;
};
