/** Curated announcements, newest first. Keep ids stable after publication. */
import type { Announcement } from '@persistent/shared'

export const announcements: readonly Announcement[] = [
  {
    id: 'themes-match-system',
    title: 'New themes and a new default',
    paragraphs: [
      'Persistent now has dedicated Light and Dark themes. Match system is the new default and automatically follows your device appearance.',
      'If you prefer the original look, Navy is still available in Settings, along with Forest and Plum.',
      'Doodles work with any theme. In Settings, choose a doodle color, match the theme, or select No doodles.'
    ]
  }
]
