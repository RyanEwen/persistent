/**
 * Last-edit-wins conflict resolution for offline sync. A write carries the wall
 * time the edit was made on the client (`clientEditedAt`); if that predates the
 * stored row's `updatedAt`, a newer edit already won and this one is stale and
 * must be ignored. Missing/garbage timestamps are treated as not-stale (apply),
 * preserving the prior last-to-arrive behavior for older clients.
 */
export function isStaleWrite(clientEditedAtIso: string | null | undefined, existingUpdatedAt: Date): boolean {
  if (!clientEditedAtIso) return false
  const edited = new Date(clientEditedAtIso).getTime()
  if (Number.isNaN(edited)) return false
  return edited < existingUpdatedAt.getTime()
}
