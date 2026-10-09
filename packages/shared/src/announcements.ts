/** Account announcements and the stable ids used to record their dismissal. */
import { z } from 'zod'

export const announcementIdSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/)
export const announcementSchema = z.object({
  id: announcementIdSchema,
  title: z.string(),
  paragraphs: z.array(z.string())
})
export const announcementListSchema = z.object({ announcements: z.array(announcementSchema) })
export type Announcement = z.infer<typeof announcementSchema>
