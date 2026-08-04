/**
 * The heading block every screen and in-page section opens with: a title and an
 * optional line of explanatory text under it.
 *
 * It exists so the four tab screens read as one app. They had drifted into three
 * different treatments — `title-md` on the lists but `title-lg` on Settings and
 * Help, a subtitle that was `text.tertiary` in some places and default in others,
 * and gaps built from a mix of `mb` on the subtitle and a `mt: -1` pulling it back
 * up under its title.
 *
 * **It carries no margin of its own.** The gap below it belongs to the section
 * container's own spacing, which is what stops the negative-margin corrections
 * coming back: put this first inside a `Stack` and that `Stack`'s `spacing` is the
 * one number deciding how far the content sits from the heading.
 */
import type { ReactNode } from 'react'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'

export function SectionHeading({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <Box>
      <Typography level="title-md">{title}</Typography>
      {subtitle !== undefined && (
        <Typography level="body-sm" sx={{ color: 'text.tertiary' }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  )
}
