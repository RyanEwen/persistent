/** Store asset updates must preserve unrelated listing and submission policy. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error - the dependency-free release runner module is plain JavaScript.
import { mergeStoreListing } from './windows-store-listing.mjs'

test('Store screenshot refresh preserves packages, logos, policy, other languages and source draft', () => {
  const draft = {
    ApplicationPackages: [{ FileName: 'release.msixbundle', FileStatus: 'PendingUpload' }],
    Pricing: { PriceId: 'Free' }, TargetPublishMode: 'Immediate',
    Listings: {
      'en-us': { BaseListing: { Title: 'Persistent', Description: 'Keep existing copy', ReleaseNotes: 'Old notes',
        Images: [{ FileName: 'old.png', FileStatus: 'Uploaded', ImageType: 'Screenshot' },
          { FileName: 'logo.png', FileStatus: 'Uploaded', ImageType: 'Icon' }] } },
      'fr-ca': { BaseListing: { Description: 'Existing translation' } }
    }
  }
  const shots = Array.from({ length: 4 }, (_, index) => ({ file: `microsoft/${index}.png`, alt: `View ${index}` }))
  const result = mergeStoreListing(draft, shots, 'A taller flyout.')
  assert.equal(draft.Listings['en-us'].BaseListing.Images[0].FileStatus, 'Uploaded')
  assert.deepEqual(result.submission.ApplicationPackages, draft.ApplicationPackages)
  assert.deepEqual(result.submission.Pricing, draft.Pricing)
  assert.deepEqual(result.submission.Listings['fr-ca'], draft.Listings['fr-ca'])
  const listing = result.submission.Listings['en-us'].BaseListing
  assert.equal(listing.Title, 'Persistent')
  assert.equal(listing.Description, 'Keep existing copy')
  assert.equal(listing.Images[0].FileStatus, 'PendingDelete')
  assert.deepEqual(listing.Images[1], draft.Listings['en-us'].BaseListing.Images[1])
  assert.deepEqual(listing.Images.slice(2).map((image: { fileName: string }) => image.fileName), shots.map((_, index) => `en-us/${index}.png`))
  assert.equal(listing.ReleaseNotes, 'A taller flyout.')
})

test('Store updates reject missing English listings and duplicate screenshot filenames', () => {
  const shots = Array.from({ length: 4 }, () => ({ file: 'microsoft/same.png', alt: 'Same' }))
  assert.throws(() => mergeStoreListing({ listings: {} }, shots, 'Notes'), /English/)
  assert.throws(() => mergeStoreListing({ listings: { 'en-us': { baseListing: { images: [] } } } }, shots, 'Notes'), /unique/)
})
