# Native Android capture provenance

Captured October 10, 2026 on Ryan's Pixel 9 Pro using native source `b3c0500` for the shade and alarm. The six app views use
the theme-aware status icon and gesture bar fix committed as `5310573`. The separate direct-debug package is `ca.persistent.app`, with the
local debug version label 0.21.1. It loads the local development app through an
ADB reverse connection and is signed in only to the protected synthetic demo
account. The installed Store package and its signed-in personal account were
preserved.

- `00-current-light.png`, `03-checklist-dark.png`, `04-medication-light.png`,
  `05-sharing-dark.png`, `06-notes-light.png`, and `07-assigned-dark.png`: actual
  full-display app screens with the real status area and gesture bar. Light themes
  use dark system icons, and dark themes use light icons. Only Persistent's
  notification icon is present. The sharing recipient is staged in an unsaved
  draft, and the medication editor was not saved.
- `01-notification-shade.png`: actual Android shade with four distinct demo
  reminders, and the plant reminder's real Done and Snooze controls expanded.
  Ryan approved retaining the full shade, including the Wi-Fi network name.
- `02-alarm-dark.png`: actual native escalation of a temporary "Check the oven"
  reminder, created through the ordinary authenticated local API with Persistent
  notifications and a one-minute escalation. It remained unconfirmed and then
  showed the real alarm with Done, Snooze, and De-escalate. Its native appearance
  was synchronized from Enjoy Dark. The demo app was force-stopped promptly after
  capture, and only that newly created reminder was deleted. The replacement
  capture has only Persistent's notification icon, with no Paseo or other app icon.

All eight source captures are 960 x 2142. They were reencoded from opaque RGBA to
24-bit RGB through `convert-store-capture.ps1`, without cropping, scaling, or
retouching. Final phone compositions were captured in the shared Paseo browser
at 720 x 1280 CSS pixels and DPR 1.5, producing 1080 x 1920 exports.

No reminder was completed by a capture action. Notifications and overlay access
were enabled only for the demo package using ordinary Android permission screens.
Exact-alarm and full-screen-intent readiness also reported enabled. This session
observed native notification actions and a real one-minute escalation into the
alarm surface; it did not
qualify offline delivery, lock-screen delivery, or swipe-return reliability.

Cleanup: demo app force-stopped, temporary ADB forward/reverse mappings removed,
on-device inspection XML removed, owned keepalive stopped, and phone returned to
Paseo. The original 120000 ms display timeout was verified unchanged. The separate
demo app remains installed and stopped for future refreshes.
