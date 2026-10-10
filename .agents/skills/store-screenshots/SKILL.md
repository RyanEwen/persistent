---
name: store-screenshots
description: Refresh Persistent Google Play and Microsoft Store screenshots using synthetic demo data, Paseo captures, reusable phone mockups, and the real Windows tray flyout. Does not publish listings.
---

Read [the capture workflow](../../../store-assets/README.md). The manifest owns carousel order, captions, themes, and raw capture paths.

Prepare the dedicated demo fixture in the isolated development database. Verify the signed-in account before capturing; never seed or capture a personal account. Reuse the existing seeded scenarios, including the synthetic vitamin dose and sample recipient. Do not complete reminders or send invitations for a screenshot.

Use full-display captures from the isolated Android demo app for every Play source
screen, including the real status area and gesture bar. Verify readable system
icons in both themes and no unrelated app notification icons. Use the shared Paseo
browser for mockup rendering. If the host cannot paint a screenshot, request activation of the existing tab and continue independent work. Do not install or launch a separate browser.

Microsoft images must contain the actual Windows tray flyout and its native chrome. Use the desktop skill's installation bridge, then the isolated capture session helper. Preserve the original settings and Store app, restore them after capture, and remove the separate dev package. Use the default 420 x 960 DIP tray placement and capture the real wallpaper and taskbar around the flyout at native resolution. Hide unrelated windows and other app tray icons before capture; do not substitute a plain canvas or retouch icons without approval. Restore any temporary window changes.

Inspect every export for clipping, readable labels, correct theme, synthetic data, and current UI. Run the asset checks and repository validation. Leave the files reviewable and uncommitted; publishing is a separate request.
