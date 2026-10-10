# Store screenshot refresh

The carousel manifest is `manifest.json`. Play exports use real app captures in reusable phone frames, with a saved studio backdrop. Microsoft exports use the actual Windows tray flyout, including its native chrome. Capture commands do not publish a listing. The separate Store workflows publish only when requested.

[Open the image preview](review.png). The gallery Markdown files use relative image links; if a viewer does not render them, open the PNG files directly.

[Review all Play images](play/README.md) and [all Microsoft images](microsoft/README.md).

## Prepare the demo

Use the existing Devkit development stack. From its Node container, in `/workspace`:

```sh
npm run shots:prepare -- --email=ryan.ewen+persistentdemo@gmail.com
```

The command accepts only that account and local development database hosts. It resets the demo reminders, preserves its sign-in methods, and creates a protected synthetic `alex@example.test` recipient with one completed assigned task. `fixture.json` records the generated reminder ids. Seed once per refresh, then keep those ids for the whole capture session. Dates are relative to preparation, with schedule-consistent passed firings, including Friday rather than Saturday for weekday reminders.

Sign in to that account on the local development origin. The development email-code response includes a preview code; use the ordinary verification endpoint without printing the code or session token. Never use production or a personal account. Set Enjoy Light or Enjoy Dark, 12-hour times, Toronto timezone, and doodles off. Dismiss announcements and the native-app promotion. For phone captures only, hide the web-only “Get the app” button, which is absent in Android, following the previous listing capture convention. Keep actual app content unchanged.

## Google Play

Use the existing shared Paseo tab. Set its viewport to **448 x 998 CSS pixels**. Capture these six scenarios in manifest order:

1. Current, Enjoy Light. The plants, puppy, and part-completed morning checklist are visible.
2. Open “Get out the door” in its reading dialog, Enjoy Dark. Do not toggle items or Done.
3. Edit “Take vitamin D”, Enjoy Light, showing the synthetic medicine name and 1000 IU dose. Do not save.
4. Create a draft reminder and open Share, Enjoy Dark. Stage `alex@example.test` in the dialog without saving or sending an invitation. Use `browser_type` for controlled fields and verify their state; `browser_fill` can report success without updating React state.
5. Notes, Enjoy Light, showing “Trip packing”.
6. Assigned by me, Enjoy Dark, showing the completed synthetic parcel pickup.

Save the PNG image block from each Paseo screenshot to the `source` path in the manifest. The helper accepts base64 on stdin: `node --import tsx scripts/dev/store-assets.ts save store-assets/raw/android/...png`. It never logs image data. Keep raw captures alongside the final exports so future caption/frame edits do not require recapturing the UI.

Run `npm run shots:render`. Navigate the Paseo tab to each generated HTML layout through Vite, for example `http://localhost:<web-port>/@fs/workspace/store-assets/render/00-current-light.html`. Set **720 x 1280 CSS pixels**, wait for the captured image to load, then screenshot. On the current Windows Paseo host, DPR 1.5 produces **1080 x 1920**. Check actual dimensions, rather than assuming the host's DPR. If another host differs, adjust the CSS viewport and renderer canvas together to produce the same export dimensions.

The mockups use a small alternating angle and reusable CSS phone frame. The app pixels come exclusively from the raw screenshots. The saved background and generation prompt are in `marketing/`; reuse them for consistency. Google recommends avoiding device imagery and skew, but this carousel deliberately includes those stylized mockups at Ryan's request.

After inspection, run `npm run shots:sync`. It validates all exports, copies the curated Play files into `../apps/mobile/store/graphics/screenshots/`, and removes superseded PNGs from that upload directory. README embeds the same files. Preserve native permission demonstration videos, which serve a separate purpose.

## Microsoft Store

Use the repository's desktop skill and `npm run install:desktop` to sideload the current working tree. Preserve the installed Store package. From Windows PowerShell 7, with repository scripts addressed using `wslpath -w`:

```powershell
./scripts/dev/store-desktop-session.ps1 -Action Start -DemoUrl http://localhost:<web-port>
./scripts/dev/store-desktop-session.ps1 -Action Show
```

The capture session saves the original settings/process paths in Windows TEMP, uses a separate WebView profile, and opens the default unpinned 420 x 960 DIP flyout above the tray. It enables a process-local WebView debugging endpoint on port 9224 for demo sign-in and navigation. If needed, pass `-SessionRoot` to both Start and Stop. Start refuses to overwrite an existing restoration backup.

Sign in to the demo account and capture Current Light, the checklist reading dialog Dark, vitamin reminder editor Light (with dose and Save visible; do not save), and Assigned by me Dark. Use the actual flyout. The helper can evaluate a JavaScript expression file through that WebView with `-ScriptFile`; defer navigation with `setTimeout` so the response returns before the context disappears. Pass `-DemoUrl` matching the session URL.

```powershell
./scripts/dev/capture-desktop-store.ps1 -DemoUrl http://localhost:<web-port> -Output <absolute-path>/store-assets/microsoft/01-current-light.png
```

The script captures a real 1440 x 1700 physical-pixel region at the monitor's bottom-right corner, including the default native flyout, desktop wallpaper, and taskbar. It preserves the captured pixels without scaling or adding a canvas. This framing keeps personal desktop shortcuts and centered app buttons outside the crop. Hide unrelated tray icons before capture, leaving Persistent and standard Windows controls visible; the script does not change tray settings or retouch icons. Temporarily minimize unrelated windows, reopen the flyout, and restore the windows after capturing. Keep the flyout unobscured; never include personal windows or reminders. No marketing copy or extra logos are added to Microsoft images.

Always restore after the capture, including after a failure:

```powershell
./scripts/dev/store-desktop-session.ps1 -Action Stop
```

Verify the original settings and Store process are restored, then remove only the separate `Persistent.Desktop` dev package and this session's TEMP folder. If windows were manually minimized, restore them too. Do not uninstall the Store app or alter its signed-in profile.

## Verify and review

Run `npm run shots:check` and `npm run validate`. Generate the contact sheet without a browser using Windows PowerShell 7: `scripts/dev/render-store-review.ps1 -AssetsRoot <absolute Windows path to store-assets>`. It reads the saved PNGs and writes `review.png`, without changing the store exports. The HTML renderer also writes `render/review.html` for interactive review. Inspect all ten final images, not just dimensions: no clipped dialogs, loading frames, missing labels, personal data, stale themes, or duplicate reminder cards. Keep Play text above the phone and concise. Record the tested source revision and capture date when refreshing; do not upload screenshots for a theme that has not shipped without coordinating the app update.

The Microsoft set was captured October 10, 2026 from the development working tree. Microsoft uses the sideloaded 0.5.8.2 native app; Play app content is browser-captured, with no native alarm or notification-shade claim.

## Publishing an approved refresh

After deploying the matching hosted UI, run the existing `play-listing` workflow
in check mode, inspect its diff, then run publish mode to submit the new Play carousel.
No Android version bump is needed for listing assets or hosted UI alone.

The `store-publish` workflow validates the Microsoft manifest and release notes,
uploads the new native package as a draft, attaches the four ordered screenshots,
using the same `.msixupload` filename registered by the CLI,
and commits the combined submission only in publish mode. It preserves other
listing fields, logos, languages, pricing, and package policy. The approved notes
are in `microsoft/release-notes.txt`. Draft mode leaves the complete package and
listing for review. A successful submission is still subject to Store processing
and certification; inspect its status before claiming the update is live.

Windows GitHub releases use `microsoft/github-release-notes.md`. Refresh both
notes files when preparing the next Windows release.

Store requirements: [Google Play preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) and [Microsoft screenshots](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images). Recheck them for future submissions.
