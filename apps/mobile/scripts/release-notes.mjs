#!/usr/bin/env node
/**
 * Build a release's "what's changed" from the commits in a tag range.
 *
 * These notes are shown verbatim in the in-app update prompt and, trimmed to
 * Play's 500-character cap, as the Play release's "what's new". They are the only
 * thing most users ever read about a release, and they are generated, so a bad
 * filter ships prose nobody can act on and the mistake is only visible once it is
 * public.
 *
 * This lives in a script rather than inline in `release.yml` because a second
 * caller now needs the identical answer: `play-notes.yml` regenerates the notes
 * for a release already on Play when the filter turns out to have been wrong. Two
 * copies of a filter this fiddly would drift, and the drift would be invisible
 * until it shipped.
 *
 * Usage:
 *   node scripts/release-notes.mjs --range v0.21.1..v0.22.0 [--repo owner/name]
 *   node scripts/release-notes.mjs --tag v0.22.0 --repo owner/name
 *
 * With --tag, the range is derived from the preceding tag, matching what the
 * release workflow does when it cuts that version.
 */
import { execFileSync } from 'node:child_process'

/** Commit subjects that describe internal work, whatever files they touched. */
export const EXCLUDE =
  /^- (bump version|merge )|\b(docs?|documentation|readme|changelog|jsdoc|chore|ci|workflow|lint|eslint|prettier|typecheck|tsconfig|devcontainer|dockerfile|compose|gitignore|deps?|dependency|dependencies|refactor|rename|cleanup|clean up|tidy|reorganize|restructure|test|tests|spec|csp|coop|coep|cors|co-?authored?)\b/i

/**
 * The paths whose changes an Android user can actually notice.
 *
 * Scoped by path as well as by keyword, because the keyword list cannot know what
 * a commit touched: `apps/desktop` (the Windows tray app) landed a dozen commits
 * matching no term, and v0.19.0 shipped "Fix an illegal '--' in the csproj
 * comment" to Google Play as a user-facing change.
 *
 * The exclusions are that same rule one level down. "Under apps/mobile" is not the
 * same as "code Android runs": `scripts/` is build tooling and `store/` is the
 * Play listing, both inside a runtime path and neither shipping behaviour.
 * Markdown never ships behaviour either, and a `*.test.ts` change is by definition
 * not user-visible. v0.22.0 went out with "Explain Play's bare precondition failed
 * on a track write" and three more like it at the top of the testers' what's-new.
 */
export const PATHS = [
  'apps/web',
  'apps/mobile',
  'apps/api',
  'packages/shared',
  ':(exclude)apps/mobile/scripts',
  ':(exclude)apps/mobile/store',
  ':(exclude)*.test.ts',
  ':(exclude)*.md'
]

export const FALLBACK = '- Maintenance and behind-the-scenes improvements'

/** Keep the subjects a user cares about, or the fallback when none survive. */
export function userFacing(subjects) {
  const kept = (subjects ?? [])
    .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
    .filter((line) => !EXCLUDE.test(line))
  return kept.length ? kept : [FALLBACK]
}

/** The whole markdown body, including the compare link when there is a previous tag. */
export function notesMarkdown(subjects, { repo, previous, tag } = {}) {
  const lines = ["## What's changed", '', ...userFacing(subjects)]
  if (repo && previous && tag) {
    lines.push('', `**Full changelog**: https://github.com/${repo}/compare/${previous}...${tag}`)
  }
  return `${lines.join('\n')}\n`
}

function git(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd })
}

/**
 * The repo root, because [PATHS] are resolved against the working directory.
 *
 * This script lives in `apps/mobile/scripts` and the workflow runs it from
 * `apps/mobile`, where every entry in PATHS matches nothing: `git log` then
 * reports no commits at all and every release gets the maintenance fallback, with
 * no error to notice.
 */
function repoRoot() {
  return git(['rev-parse', '--show-toplevel']).trim()
}

/** Commit subjects in [range] that touched a path a user can notice. */
export function subjectsIn(range, cwd = repoRoot()) {
  const out = git(['log', '--no-merges', '--pretty=format:%s', range, '--', ...PATHS], cwd)
  return out.split('\n').filter((line) => line.trim())
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    args[key] = next && !next.startsWith('--') ? (i += 1, next) : true
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  let range = typeof args.range === 'string' ? args.range : null
  let previous = null
  const tag = typeof args.tag === 'string' ? args.tag : null

  if (!range) {
    if (!tag) {
      console.error('[release-notes] need --range <a..b> or --tag <vX.Y.Z>')
      process.exit(1)
    }
    try {
      previous = git(['describe', '--tags', '--abbrev=0', `${tag}^`]).trim()
    } catch {
      // No earlier tag: the range is everything up to this one, and there is
      // nothing to compare against, so the changelog link is omitted.
      previous = null
    }
    range = previous ? `${previous}..${tag}` : tag
  } else if (range.includes('..')) {
    previous = range.split('..')[0]
  }

  const repo = typeof args.repo === 'string' ? args.repo : null
  process.stdout.write(
    notesMarkdown(subjectsIn(range), { repo, previous, tag: tag ?? range.split('..')[1] })
  )
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
