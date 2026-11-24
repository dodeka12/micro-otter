# Changes since version 1.37.0

## New Features

- **Interrupt-triggered graphs** — new `interrupt-input` and `interrupt-enable` nodes bind a GPIO pin
  to a named interrupt channel, and a new `irq` graph execution mode runs a graph's loop body once per
  interrupt instead of on a cadence; the device target derives an `irq` pin capability from digital
  inputs.
- **Signal-triggered graphs** — a new `signal-post` node raises named pulse signals, and a new `event`
  graph execution mode watches a list of signals with an `any`/`all` trigger plus an optional
  run-on-start. Both the graph settings view and the graph panel toolbar expose a checkbox
  multi-select **Signals** dropdown and a **Trigger mode** dropdown, and new signal names are created
  only on `signal-post` nodes.

## Bug Fixes

- **Event graph signal list now follows `signal-post` nodes** — the settings view refreshes its
  signal choices when a `signal-post` node is added, renamed, or removed, and the toolbar's picker
  does the same.
- **Event graph signal styling restored** — a missing closing brace in `graph-settings-view.css` was
  nesting the signal-list, error and warning rules and breaking their layout and colours.
- **Signal-post name picker reveals its name field** — choosing "Define signal…" now shows the
  signal-name control, and a new `(not set)` option disables the node without a validation error
  instead of reporting a blank name.
- **Restored `irq` capability on ESP32-S3 Mini devices** — a device whose stored target was written
  as the legacy five-key bootstrap skeleton (no pin information) is now reported as needing a target
  again instead of silently losing the derived `irq` pin capability; confirming the reopened target
  dialog rewrites a complete payload in one step.
- **Wrong-family targets are refused** — `_uploadTargetConfiguration` now asserts the image-family
  rule itself and rejects a target that cannot run on the flashed firmware, with a localised
  `deployment.errors.targetNotCompatible` message instead of an internal hint.
- **Event-graph signal badges follow the selection** — the graph panel now passes the graph's watched
  signals, trigger mode, and run-on-start setting to the graph rules and re-validates when they
  change, so an `event` graph with a signal selected no longer marks every node with "This event graph
  has no signals selected", and the badge clears as soon as a signal is ticked.
- **Signals row has no gap above the picker** — the settings view renders the Signals title through
  the reusable dropdown's own `label` instead of a stacked caption that inherited the 120 px row
  gutter as its height.
- **Duplicate interrupt GPIOs are rejected** — two `interrupt-input` nodes claiming the same pin are
  now badged on the `pin` control and stop the build with a clear error instead of the second
  `pin.irq()` silently replacing the first handler, which left the first interrupt counting nothing.
- **Interrupts in different graphs no longer overwrite each other** — generated init variables now
  include the graph scope (`_irq_<scope>_<id>`, `_i2s_in_<scope>_<id>`), so two graphs whose node ids
  coincide no longer read each other's channel, counter, or audio chain objects.

## Refactor

- **The app is the single writer of `active_target.json`** — `DeviceDeployment._uploadTargetConfiguration`
  remains the only writer of `/device/targets/active_target.json`; firmware bootstrap setup no longer
  writes target content, and its writable-path contract shrinks from four files to three
  (`/manifest.json`, `/device.json`, `/app/main_loop.py`) plus the optional custom view.
- **Legacy `capabilities` key removed end to end** — the writer stops emitting `capabilities`, the
  device-side `_validate_active_target_payload` that required it is deleted, and no host path reads
  it; no compatibility shim ships because there are no public releases to stay compatible with.
- **One completeness predicate for target payloads** — `isCompleteActiveTargetPayload`
  (`js/data/target-payload.ts`) requires a non-empty `targetId` plus non-empty `pinCapabilities` or a
  valid `openPins` range, and is used both by the writer and by the device-info reader.
- **Honest target reader** — `loadDeviceInfo` rejects incomplete or image-incompatible stored targets,
  so `deviceTargetInfo` stays `null`, the existing `needs-onboarding` verdict takes over, and
  `DeviceDeployment.targetConfigurationIssue` reports `'missing'`, `'incomplete'` or
  `'image-incompatible'` through the localised `deployment.errors.deviceTargetNotConfigured` /
  `deviceTargetIncompatible` messages.
- **Prefilled repair dialog** — the existing `ViewManager.showFormDialog` target dialog opens with the
  rejected payload's `targetId` and `/device.json`'s `targetUserDescription` preselected and lists only
  targets that can run on the flashed firmware; no new view or markup.
- **Shared execution-type contract** — `graph-execution-settings.ts` now owns the
  `GRAPH_EXECUTION_TYPES` list and `normalizeExecutionType`, so the settings view, toolbar and
  transpiler agree on the valid modes.
- **Data-driven execution dropdown** — the settings view builds its execution options from one list
  plus a per-type field-visibility map, so `irq` and `event` are each one added entry.
- **Shared transpiler trigger helpers** — interrupt and event graphs share a single
  `#validateTriggerBindings` entry point and a `#emitWaitStatement` wait-line formatter.

## Breaking Changes

None.
