# Changes since version 1.25.0

## New Features
- **A firmware version now means one thing** — a release is an immutable `firmware-v<base>` git tag
  and every later commit is a `<base>-dev.<distance>.g<sha7>` pre-release, resolved once by
  `resolve_firmware_version()` instead of a package-lineage counter.
- **Add-ons are part of the identity** — `contentHash` now hashes the selection and the add-on
  packages, so a build whose only change is an installed add-on publishes a different name.
- **Channel-aware latest** — the inventory reports `latestByChannel` and deploy/staleness resolve
  inside a requested channel (`release`/`dev`) with no cross-channel fallback.
- **Composition staleness** — staleness compares content hashes first, so a rebuild that only
  moved the git distance is up-to-date while a differing hash is `content-changed`.
- **Firmware build history** — every build appends a record to the publish-root
  `firmware_history.json` instead of rewriting the committed registries; the device app reads a
  composed view of baselines plus history.
- **Per-channel `latest` marks and the base/dev split in the Firmware tab** — the inventory list
  marks the newest image of each channel and renders the pre-release tail as its own dimmed span.
- **Existing-firmware hint in the Build Firmware group** — when a published image already embeds
  every ticked package, the group names it (`{{version}}`) so the image can be deployed instead of
  rebuilt; the line is hidden until the inventory has been read, so an unknown list never claims
  "no firmware exists".

## Improvements
- **One semver grammar** — `version_semver.VERSION_RE` replaces the four module-local `SEMVER_RE`
  copies.
- **One assets-version reader** — the compile-owned runtime assets version is read only by
  `staging_runtime_assets.read_packaged_runtime_assets_version()`.
- **One identity resolver** — the pre-build guard, the `device.json` bake, and the publish step all
  consume `resolve_build_identity()`.
- **Two new CLI staleness labels** — `contents changed` and `no image in channel`.
- **Firmware coverage badges read the image, not the request** — the inventory list now draws a
  moon-phase pair from what the sidecar *froze* (`embeddedPackages` plus `addonPackages`): the filled
  circle (`complete`) marks an image that embeds every built-in package the target can embed, the
  half circle (`partial`) marks a subset build. The two are mutually exclusive, so a build with all
  packages no longer shows up as `partial`, and the previous generic list glyph is gone from the row.
- **Two compatibility markers, not three** — the inventory list keeps the tick (`compatible`) and the
  question mark (`unknown`) and drops the half-filled `incomplete` glyph;
  the Deploy group's "does not embed: …" line still reports a missing package.
- **Add-ons badge reads the sidecar** — an image is flagged as containing add-ons from its
  `addonPackages` object (plus any embedded id the runtime still classifies as an add-on); before,
  only `embeddedPackages` was inspected, which holds built-ins, so a v2 image with add-ons carried
  no add-ons badge.
- **Compatible tick counts add-ons** — the same split hid the tick: `classifyFirmwareCompatibility()`
  now compares the ticked packages against `embeddedPackages` *plus* `addonPackages`, like the
  coverage badges and the Build Firmware hint already did. Because the Installed add-ons list ticks
  every installed add-on by default, a build of a filtered package selection kept the add-on in the
  request, so its fresh image came back `partial` *and* without the tick even though it embedded
  everything asked for. It now shows both.
- **Inventory list scrolls sideways** — the table host now captures horizontal overflow, so grown
  columns scroll instead of being clipped by the section box.
- **Redundant runtime column dropped** — the Firmware-tab inventory list hides the runtime column
  when every shown image shares one runtime.
- **Only buildable targets in the Firmware tab** — the Target dropdown lists the targets the server
  resolves a board for, so the wildcard targets `Generic` (`generic_micropython`) and `Custom
  Device` (`custom`) are no longer offered; both are answered with `target-unknown` by every build
  and deploy request, so selecting one could only fail. The catalog default is `generic_micropython`,
  so the tab now starts on the first buildable target instead of a target it cannot build. If no
  target resolves a board at all, the full list is kept and the info row names the reason.
- **Nested sub-section headers in the Firmware tab** — the three Build Firmware sub-sections
  (Packages, Installed add-ons, Build log) use the new shared `CollapsibleView` `nested` variant, a
  header one surface step lighter with a lighter title weight, so they read as one level below the
  card that holds them. The variant lives in the shared view and is opt-in, so no firmware-specific
  styling was added.
- **The Firmware tab is one split view** — the five section cards are now panes of a vertical
  `SplitView` (plus a sixth, Help), each a `CollapsibleView` with its own scrolling content and a
  draggable splitter between neighbours. A long package or inventory list scrolls inside its pane
  instead of pushing the whole tab into one long scrollbar, so the tab header and the collapsed pane
  headers stay in place. The whole-view scroll host is gone.
- **A Help pane instead of header text** — the purpose summary and the no-reinstall note moved from
  the tab header into a first pane titled *Help*, collapsed by default, so the explanation is there
  for a first-time user and out of the way afterwards. Both lines are re-rendered on a language
  switch.
- **Pane toolbars** — the Build and Deploy controls lead their pane as a `ToolbarView` first row
  (Build button, then its checkbox; Deploy button, then the wipe checkbox), attached straight to the
  pane root. The row needs no wrapper element and no `.view-toolbar` override, because the pane's own
  column layout places it. The row is content: a folded pane hides it with the body, so a started job
  expands its pane and the controls return together with the progress readout.
- **One button treatment** — Build and Deploy are both icon-only `ButtonControl`s now (Build was the
  only labelled one) and both keep `style: 'secondary'`, the variant the Packages, Installed add-ons
  and Local firmware toolbars already use, so the pane rows and the panel rows render the same 28px
  bordered icon button. The label lives on as the tooltip and the accessible name, and the Build glyph
  still becomes the cancel glyph while a job runs. Each button is followed by its checkbox, so the
  only modifier of a deploy sits to the right of the action it modifies, in the pane's first row above
  the port.
- **Panel toolbars use the standard height** — the Packages, Installed add-ons, and Local firmware
  toolbars no longer override the shared `ToolbarView` height, and the two pane rows above keep it
  unchanged as well.
- **The deploy port is the port list, with a rescan beside it** — the Deploy port row is now one
  `ToolbarView` row holding the connected-port `DropdownControl` followed by an icon-only rescan
  `ButtonControl`, the same shape as the WebSocket device selector in the connection view: the only
  choices are the ports the host reports, by name, and the button re-reads `/api/serial-ports` so a
  board plugged in after the tab opened appears without reopening it. The typed-port `TextControl`
  that sat under the chooser is gone, so a port is never entered by hand. A rescan says
  `firmwareBuild.deploy.portsLoading` (new in both locales) while it runs, joins a scan already in
  flight instead of starting a second, leaves the current options on screen, and keeps the ports
  already known when the read fails.

## Bug Fixes
- **The build and deploy checkboxes no longer touch their button** — `CheckboxControl` renders no
  horizontal padding of its own, so inside a `ToolbarView` row the clean-build and wipe labels sat
  `1px` (`--mo-gap`) from the icon button in front of them. `toolbar-view.css` now gives every
  toolbar checkbox `padding: 0 6px`, the optical margin a button's own `6px 10px` padding provides,
  so the control clears its neighbour on both sides while the 36px row height stays untouched. It is
  scoped to `.view-toolbar__controls` in the shared toolbar stylesheet, so a checkbox in a settings
  group or a node UI panel keeps its zero padding, and `tests/views/toolbar-view.test.js` pins the
  horizontal-only padding.
- **The existing-firmware line says "includes" when the image is a superset** — a published
  all-packages image also covers a minimal tick, and the line reported that case with the exact wording
  ("Firmware for this selection already exists"), so narrowing the checklist still claimed the slim
  firmware existed. The visible sentence now follows `FirmwareSelectionMatch.exact`: exact matches read
  `firmwareBuild.build.matchingFirmware` ("a firmware for *exactly* this selection already exists"),
  superset matches read the new `firmwareBuild.build.matchingFirmwareSuperset` ("a firmware that
  *includes* this selection already exists") in both locales, and the superset hint states that a
  rebuild would only slim the image. Neither state disables Build — the line informs, it never gates a
  deliberate minimal build.
- **The compatibility tick judges the image against the collection, not the build checkboxes** —
  the inventory row asked "does this image embed every *ticked* package?", so a firmware built from
  a `Minimal` selection could never earn a tick again: the image embeds only what the collection
  uses, while the checklist keeps every installed add-on ticked. The tick and the Deploy group's
  "does not embed: …" banner now compare against what the active collection needs, resolved once by
  `FirmwarePackagesPanel.collectionPackageIds()` — the same resolver the **Minimal** button uses, so
  button and tick can no longer disagree. The Build Firmware group's "existing firmware" line keeps
  reading the ticked selection, because it answers the next build's question, and the two inputs are
  separate types now (`FirmwareCompatibilityContext.requiredPackageIds` versus
  `FirmwareSelection.packageIds`). The list is re-judged when a node is added to or removed from the
  collection, and a collection that needs no package shows no marker at all.
- **The port chooser lists attached devices only** — `detect_serial_ports()` used to report
  everything pyserial finds, and on Linux that includes the kernel's 32 phantom 8250 UARTs
  (`/dev/ttyS0`…`/dev/ttyS31`) with `vid`/`pid` `None` and `hwid`/`description` `"n/a"`, which buried
  the two or three boards that really were plugged in — in the Deploy chooser, in the connection
  view's device selector, and in the CLI's numbered port list. `_has_device_identity()` now drops an
  entry only when pyserial reports *no* identity for it, so a real UART (`PNP0501`) or an unfamiliar
  platform keeps its port and the `/api/serial-ports` payload shape is unchanged.
- **A long port name no longer stretches the Deploy row** — a board's `/dev/serial/by-id` label is as
  long as its USB descriptor, and the port trigger grew with it until the rescan button was pushed
  out of the row. `.firmware-build-view__dropdown--port` now caps the trigger at `220px` and the
  shared label rule ellipsizes the text; `DropdownControl` puts the full label on the trigger and on
  every option label as a `title`, so the truncated name stays readable on hover, and the
  viewport-capped menu (`min(420px, calc(100vw - 16px))`) still prints the whole by-id name.

## Limitations
- Published images keep their old names; they stay readable, not renamed.
- `release.json` is metadata, not the version source.
- The deploy UI still defaults to newest-across-channels (no channel selector yet).
