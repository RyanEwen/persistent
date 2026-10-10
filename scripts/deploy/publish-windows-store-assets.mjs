/** Upload approved screenshots and notes into the CLI-created Store draft, then optionally commit it. */
import { readFile, copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { pngSize } from '../../apps/mobile/scripts/play-publish.mjs'
import { member, mergeStoreListing } from './windows-store-listing.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const assetsRoot = path.join(root, 'store-assets')
const productId = '9PCX2XGQ7CJS'
const origin = 'https://manage.devcenter.microsoft.com'

/** Validate all local artifacts before authenticating or changing the pending Store submission. */
async function loadAssets() {
  const manifest = JSON.parse(await readFile(path.join(assetsRoot, 'manifest.json'), 'utf8'))
  const notes = await readFile(path.join(assetsRoot, 'microsoft/release-notes.txt'), 'utf8')
  for (const shot of manifest.microsoft) {
    if (!/^microsoft\/[a-z0-9-]+\.png$/.test(shot.file)) throw new Error('Unexpected desktop screenshot path.')
    const bytes = await readFile(path.join(assetsRoot, shot.file))
    const size = pngSize(bytes)
    if (!size || size.width < 1366 || size.height < 768 || bytes.length > 50 * 1024 * 1024
      || bytes.length < 33 || bytes[24] !== 8 || bytes[25] !== 2) {
      throw new Error(`Invalid Store screenshot: ${shot.file}`)
    }
  }
  // Exercise metadata validation without needing a live draft in local check mode.
  mergeStoreListing({ listings: { 'en-us': { baseListing: { images: [] } } } }, manifest.microsoft, notes)
  return { shots: manifest.microsoft, notes }
}

/** Create a short-lived authenticated API client; never print credentials, responses, or SAS URLs. */
async function requester() {
  const tenant = process.env.AZURE_AD_TENANT_ID
  const client = process.env.AZURE_AD_APPLICATION_CLIENT_ID
  const secret = process.env.AZURE_AD_APPLICATION_SECRET
  if (!tenant || !client || !secret) throw new Error('Missing Microsoft Store credentials.')
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client,
      client_secret: secret, scope: `${origin}/.default` })
  })
  if (!response.ok) throw new Error(`Store authentication failed (${response.status}).`)
  let token
  try {
    token = await response.json()
  } catch {
    throw new Error('Store authentication returned invalid JSON.')
  }
  if (!token.access_token) throw new Error('Store authentication returned no token.')
  return async (route, method = 'GET', body) => {
    const result = await fetch(`${origin}/v1.0${route}`, {
      method, headers: { Authorization: `Bearer ${token.access_token}`, TenantId: tenant, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!result.ok) throw new Error(`Store ${method} failed (${result.status}).`)
    const text = await result.text()
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      // An API response can contain upload credentials, so keep parser errors out of logs.
      throw new Error('Store API returned invalid JSON.')
    }
  }
}

/** Stage the matching bundle and image files in one ZIP, matching Partner Center's registered names. */
async function archive(packagePath, assets, directory) {
  const contents = path.join(directory, 'contents')
  await mkdir(contents)
  await copyFile(packagePath, path.join(contents, path.basename(packagePath)))
  for (const asset of assets) {
    const target = path.join(contents, asset.fileName)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(path.join(assetsRoot, asset.source), target)
  }
  const output = path.join(directory, 'submission.zip')
  const result = spawnSync('tar.exe', ['-a', '-cf', output, '-C', contents, path.basename(packagePath), 'en-us'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Could not create Store package and screenshot archive.')
  return output
}

/** Update only the current pending draft, preserving its package identity and all unowned metadata. */
async function publish(packagePath, commit) {
  if (process.platform !== 'win32') throw new Error('Run Store publication on the Windows release runner.')
  const { shots, notes } = await loadAssets()
  const request = await requester()
  const application = await request(`/my/applications/${productId}`)
  const id = member(member(application, 'pendingApplicationSubmission'), 'id')
  if (!id) throw new Error('The CLI did not create a pending Store submission.')
  const route = `/my/applications/${productId}/submissions/${encodeURIComponent(id)}`
  const draft = await request(route)
  if (member(draft, 'status') !== 'PendingCommit') throw new Error('The Store submission is not an editable pending draft.')
  const packages = member(draft, 'applicationPackages')
  if (!Array.isArray(packages) || !packages.some((entry) => member(entry, 'fileName') === path.basename(packagePath))) {
    throw new Error('The Store draft does not contain the selected release bundle.')
  }
  const merged = mergeStoreListing(draft, shots, notes)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'persistent-store-upload-'))
  try {
    const uploadArchive = await archive(packagePath, merged.assets, directory)
    const updated = await request(route, 'PUT', merged.submission)
    const uploadUrl = member(updated, 'fileUploadUrl') ?? member(draft, 'fileUploadUrl')
    if (!uploadUrl) throw new Error('The Store draft returned no upload URL.')
    let destination
    try {
      destination = new URL(uploadUrl)
    } catch {
      throw new Error('The Store draft returned an invalid upload URL.')
    }
    if (destination.protocol !== 'https:' || !destination.hostname.endsWith('.blob.core.windows.net')) {
      throw new Error('The Store draft returned an unexpected upload host.')
    }
    const size = await stat(uploadArchive)
    const upload = await fetch(uploadUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/zip', 'Content-Length': String(size.size), 'x-ms-blob-type': 'BlockBlob' },
      body: createReadStream(uploadArchive), duplex: 'half'
    })
    if (!upload.ok) throw new Error(`Store artwork upload failed (${upload.status}).`)
    console.log(`Uploaded ${shots.length} approved screenshots and release notes to submission ${id}.`)
    if (commit) {
      await request(`${route}/commit`, 'POST', {})
      console.log(`Committed Microsoft Store submission ${id} for processing.`)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const packageIndex = process.argv.indexOf('--package')
try {
  if (process.argv.includes('--check')) {
    const { shots } = await loadAssets()
    console.log(`Microsoft Store assets valid: ${shots.length} screenshots and release notes.`)
  } else if (packageIndex >= 0 && process.argv[packageIndex + 1]) {
    await publish(path.resolve(process.argv[packageIndex + 1]), process.argv.includes('--commit'))
  } else {
    throw new Error('Usage: publish-windows-store-assets.mjs --check | --package <msixbundle> [--commit]')
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Store publication failed.')
  process.exitCode = 1
}
