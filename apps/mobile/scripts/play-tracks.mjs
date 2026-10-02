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
    await writeTrack({ track: track.track, releases: [] })
  }
}
