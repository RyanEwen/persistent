/** Phone-track cleanup shared by production uploads and promotion of existing bundles. */

/**
 * Clear active phone testing releases inside the caller's existing Play edit.
 * Production and other form factors retain their releases. The injected writer
 * must reject failed updates so the caller never commits a partial transition.
 */
export async function retirePhoneTestingTracks(tracks, writeTrack) {
  for (const track of tracks ?? []) {
    if (track.track === 'production' || track.track.includes(':') || !track.releases?.length) {
      continue
    }
    // An empty release retires the served bundles. An empty releases array
    // is accepted by Play but leaves the existing completed release in place.
    await writeTrack({ track: track.track, releases: [{ status: 'completed', versionCodes: [] }] })
  }
}
