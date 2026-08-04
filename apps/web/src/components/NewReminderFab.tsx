/**
 * Floating "New reminder" action for the two list screens (Current, Upcoming).
 *
 * Deliberately quieter than Done. Done (`OccurrenceActions`) is the app's whole
 * point and is solid `success`; this used to be a full-width solid `primary` bar
 * sitting directly above it, which on the accent themes made *creating* work the
 * loudest thing on the screen that exists to *finish* it. Soft + floating keeps it
 * always reachable without competing.
 *
 * Three positioning invariants, all easy to lose:
 * - **Bottom-left, not the conventional bottom-right.** Done and Snooze are
 *   right-aligned in every attention card, so the right corner is the one place a
 *   floating control must not sit: at narrow widths (the Windows flyout goes down
 *   to 320) a card's buttons wrap onto their own row and land exactly there, and
 *   the button covered Done at rest. A floating control always overlaps
 *   *something*; on the left it can only ever cover body text.
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
            justifyContent: 'flex-start',
            pointerEvents: 'none'
          }}
        >
          <Button
            component={RouterLink}
            to="/reminders/new"
            variant="soft"
            startDecorator={<AddIcon />}
            sx={{
              pointerEvents: 'auto',
              borderRadius: 'xl',
              boxShadow: 'lg',
              // `soft` alone is a tint; over the themed doodle background it needs
              // an opaque backdrop and an edge to read as floating rather than as
              // part of the card behind it.
              bgcolor: 'background.surface',
              border: '1px solid',
              borderColor: 'primary.outlinedBorder',
              '&:hover': { bgcolor: 'background.level1' }
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
