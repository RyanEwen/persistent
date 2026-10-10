/** Merge approved screenshots and notes into an existing Store draft without resetting other fields. */

/** Read API members regardless of the casing used by the Store CLI. */
export function member(object, name) {
  const key = Object.keys(object ?? {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key ? object[key] : undefined
}

/** Require the exact CLI input filename, not the bundle nested inside an upload wrapper. */
export function assertReleasePackage(draft, fileName) {
  const packages = member(draft, 'applicationPackages')
  if (!Array.isArray(packages) || !packages.some((entry) => member(entry, 'fileName') === fileName)) {
    throw new Error('The Store draft does not contain the selected release package.')
  }
}

/** Write a member while preserving the API response's original property casing. */
function setMember(object, name, value) {
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === name.toLowerCase()) ?? name
  object[key] = value
}

/** Replace only desktop screenshots in English; preserve logos, other languages, packages and policy. */
export function mergeStoreListing(draft, shots, notes) {
  if (shots.length < 4 || shots.length > 10) throw new Error('Expected 4 to 10 approved desktop screenshots.')
  if (!notes.trim() || notes.length > 1500) throw new Error('Store release notes must contain 1 to 1500 characters.')
  const updated = structuredClone(draft)
  const listings = member(updated, 'listings')
  const language = Object.keys(listings ?? {}).find((key) => key.toLowerCase() === 'en-us')
  if (!language) throw new Error('The pending Store submission has no English listing.')
  const listing = member(listings[language], 'baseListing')
  const images = member(listing, 'images')
  if (!Array.isArray(images)) throw new Error('The pending Store listing has no image collection.')
  const retained = images.map((image) => {
    if (String(member(image, 'imageType')).toLowerCase() !== 'screenshot') return image
    const removed = { ...image }
    setMember(removed, 'fileStatus', 'PendingDelete')
    return removed
  })
  const assets = shots.map((shot) => ({
    source: shot.file,
    fileName: `en-us/${shot.file.split('/').at(-1)}`,
    description: shot.alt
  }))
  if (new Set(assets.map((asset) => asset.fileName)).size !== assets.length) {
    throw new Error('Screenshot filenames must be unique.')
  }
  setMember(listing, 'images', [...retained, ...assets.map((asset) => ({
    fileName: asset.fileName, fileStatus: 'PendingUpload', imageType: 'Screenshot',
    description: asset.description.slice(0, 200)
  }))])
  setMember(listing, 'releaseNotes', notes.trim())
  return { submission: updated, assets }
}
