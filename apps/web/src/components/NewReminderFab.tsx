/**
 * Floating "New reminder" action for the two list screens (Current, Upcoming).
 *
 * Deliberately quieter than Done. Done (`OccurrenceActions`) is the app's whole
 * point and is solid `success`; this used to be a full-width solid `primary` bar
 * sitting directly above it, which on the accent themes made *creating* work the
 * loudest thing on the screen that exists to *finish* it. Soft + floating keeps it
 * always reachable without competing.
 *
 * Colour matches `GetTheApp.tsx` — soft `primary`, no border — so the app's two
 * "go do a thing" buttons read as the same control. Neutral-on-surface read as a
 * disabled chip and was easy to miss; an accent border instead made it an outlined
 * chip. The ceiling is the rule above: a soft tint may not become a solid accent
 * fill, because that is the thing that outranked Done last time.
 *
 * Two deviations from plain `<Button variant="soft" color="primary">`, both forced
 * by this button floating over the page rather than sitting in it:
 * - The tint is a `linear-gradient` layer over an opaque `background.surface`
 *   rather than `bgcolor`, because `primary.softBg` is translucent
 *   (`rgba(..., 0.14)`) and a see-through button over the themed doodle background
 *   reads as part of whatever card it happens to be over.
 * - Hover stacks that same layer twice instead of using `softHoverBg`, which is
 *   NOT one of the variables `settings/themes.ts` overrides per accent — it would
 *   flash the default amber on every theme except Plain.
 *
 * Two positioning invariants, both easy to lose:
 * - It anchors to the same 640px centred column as `AppLayout`, not the viewport,
 *   or it drifts into the margin on a wide window.
 * - It clears `BottomNav` *and* `env(safe-area-inset-bottom)` — the nav extends its
 *   own background down behind the Android gesture bar, so a bare pixel offset
 *   parks the button on top of the tabs on an edge-to-edge device.
 *
 * The wrapper spans the full column width to place the button, so it is
 * `pointerEvents: 'none'` with the button re-enabling itself — otherwise an
 * invisible strip would swallow taps on whatever card sits behind it.
 *
 * It sits bottom-right, the conventional corner. Known cost, accepted rather than
 * overlooked: Done and Snooze are right-aligned in every attention card, so at
 * narrow widths — the Windows flyout goes down to 320 — a card's buttons wrap onto
 * their own row and the button can cover them until you scroll. It was tried on
 * the left, which removes that entirely, and bottom-left looked wrong enough not
 * to be worth it. If the collision ever needs solving without moving it back, the
 * options are shrinking to an icon under a width breakpoint or hiding it while
 * scrolling down.
 *
 * **The button is portalled to `document.body` and that is load-bearing.** Both
 * screens are wrapped in `PullToRefresh`, which sets `transform: translateY(...)`
 * — and any transform other than `none` makes that element the containing block
 * for `position: fixed` descendants. Rendered in place the button positions
 * against the (page-tall) pull container instead of the viewport and lands off
 * screen entirely. The spacer stays in the flow, where it is the thing that
 * actually needs to occupy layout.
 */
import { createPortal } from 'react-dom'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/joy/Box'
import Button from '@mui/joy/Button'
import AddIcon from '@mui/icons-material/Add'

export function NewReminderFab() {
  return (
    <>
      {/* In-flow spacer: the button is fixed, so nothing else can push the last
          card out from under it. Sized to the button plus its gap. */}
      <Box aria-hidden sx={{ height: 48 }} />
      {createPortal(
        <Box
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
            // Under BottomNav's z-index of 10, so it can never sit over the tabs.
            zIndex: 9,
            mx: 'auto',
            maxWidth: 640,
            px: 2,
            display: 'flex',
            justifyContent: 'flex-end',
            pointerEvents: 'none'
          }}
        >
          <Button
            component={RouterLink}
            to="/reminders/new"
            variant="soft"
            color="primary"
            startDecorator={<AddIcon />}
            sx={{
              pointerEvents: 'auto',
              borderRadius: 'xl',
              boxShadow: 'lg',
              // Opaque base + accent tint layered on top; see the header for why
              // the tint cannot simply be `bgcolor: 'primary.softBg'`.
              bgcolor: 'background.surface',
              backgroundImage:
                'linear-gradient(var(--joy-palette-primary-softBg), var(--joy-palette-primary-softBg))',
              color: 'primary.softColor',
              '&:hover': {
                bgcolor: 'background.level1',
                // The same translucent layer twice — a stronger tint built only
                // from variables the accent themes actually override.
                backgroundImage:
                  'linear-gradient(var(--joy-palette-primary-softBg), var(--joy-palette-primary-softBg)), ' +
                  'linear-gradient(var(--joy-palette-primary-softBg), var(--joy-palette-primary-softBg))'
              }
            }}
          >
            New reminder
          </Button>
        </Box>,
        document.body
      )}
    </>
  )
}
