/** Map a validated reminder input to Prisma columns for both owner and assignee creation. */
import type { Prisma } from '@prisma/client'
import { reminderInputSchema } from '@persistent/shared'

/** Keep ownership outside this mapping so callers choose the actual reminder owner. */
export function toReminderData(
  input: ReturnType<typeof reminderInputSchema.parse>
): Omit<Prisma.ReminderUncheckedCreateInput, 'userId'> {
  return {
    title: input.title,
    details: input.details ?? null,
    type: input.type,
    typeData: input.typeData as Prisma.InputJsonValue,
    schedule: input.schedule as unknown as Prisma.InputJsonValue,
    persistence: input.persistence,
    soundIntervalSeconds: input.soundIntervalSeconds,
    sounds: input.sounds as unknown as Prisma.InputJsonValue,
    shadeProminence: input.shadeProminence,
    escalateAfterMinutes: input.escalateAfterMinutes,
    escalateAtTime: input.escalateAtTime,
    escalateEmail: input.escalateEmail,
    escalateEmailMessage: input.escalateEmailMessage,
    escalateEmailAfterMinutes: input.escalateEmailAfterMinutes,
    active: input.active,
    startDate: input.startDate,
    endDate: input.endDate,
    // A note owns checklist ticks; scheduled firings own their own ticks.
    ...(input.schedule.kind === 'never' ? {} : { checkedItems: [] })
  }
}
