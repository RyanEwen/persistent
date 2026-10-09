/** Load account news and queue its viewed records through the authenticated data layer. */
import { useAnnouncements, useViewAnnouncement } from '../data/announcements.js'
import { useAuth } from '../auth/useAuth.js'
import { AnnouncementDialogContent } from './AnnouncementDialogContent.js'

export function AnnouncementDialog() {
  const query = useAnnouncements()
  const viewed = useViewAnnouncement()
  const { offline } = useAuth()
  return (
    <AnnouncementDialogContent
      announcements={query.data}
      loaded={query.isSuccess && !query.isFetching}
      enabled={!offline && !query.isFetching}
      onViewed={viewed.mutate}
    />
  )
}
