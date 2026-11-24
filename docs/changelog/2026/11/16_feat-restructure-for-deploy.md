# Changes since version 1.25.0

## New Features

- **A first-class `core.tuple` value type** — the `core` package ships a namespaced, immutable,
  heterogeneous tuple type (colour `#9b7ad6`, `kind: "value"`, one producer per input, fan-out
  outputs) whose generated Python is an ordinary tuple literal: there is no runtime wrapper module.
- **`compose` and `decompose` build and open tuples** — `core.compose` collects two to eight
  connected values (chosen with the `Positions` dropdown) into one tuple literal with a trailing
  comma, writing `None` for every unconnected position; `core.decompose` reads the connected
  positions back with `isinstance`/`len` guards, so a short or non-tuple input yields `None`
  instead of raising.
- **`tuple-select` reads one tuple position at runtime** — `core.tuple-select` takes a tuple and a
  connectable `index` with a number default, counts positions from zero, truncates fractions before
  the range check, and returns `None` for a non-numeric index or an index outside
  `0 <= index < len(tuple)`.
- **Import a stock MicroPython image** — the Local firmware Import button now accepts a raw
  `.bin` from the server picker or a URL (routed by extension alongside `.firmware.zip`), asks for
  the platform once so the board slug becomes part of the published name and the flash path, and
  lands it in the inventory through the new `firmware.import-binary` frame. The imported image
  carries no Micro Otter runtime, so the runtime is installed from the Device tab afterwards; a
  `.uf2` image is not accepted yet.
- **ESP32-S2 target** — `esp32_s2` is a selectable standalone target with DAC on GPIO17/GPIO18,
  ADC1/ADC2, touch and native USB; builds resolve the MicroPython `ESP32_GENERIC_S2` board and the
  CLI, board catalog and flash backend accept the `esp32s2` chip.

## Breaking Changes

- **`core.select` is a single channel** — the node keeps only `condition`, `trueValue`,
  `falseValue` and one `value` output; the `Channels` control and every `trueValue_n` /
  `falseValue_n` / `value_n` connector are gone. Saved multi-channel select nodes are reduced to
  channel 1 on load, and their channel 2–10 defaults and connections are dropped rather than
  reinterpreted. A graph that used the mux must be rebuilt with one `select` per value pair.
- **A mixed tuple/scalar union now reports `any`** — `resolveUnionOutputType()` returns `any`
  whenever two or more distinct candidates include a namespaced id, so a `select` fed by a
  `core.tuple` branch and a scalar branch no longer claims the scalar's type. Connection validation
  is unchanged: every candidate must still fit the target, so a `core.tuple`-only or `float`-only
  input refuses such a union and only an `any` input accepts it.
- **Capability requirements now come from pin usage** — a `resourceUsage` pin entry is the node's
  hardware requirement, so addon packages that list a pin in `resourceUsage` report an error on
  targets without that capability where they used to stay silent; `capabilityCheck` handlers no
  longer hide a declaration (`stdmo.servo` now reports `pwm.output` on PWM-less targets); and a pin
  whose picker uses `allowNone` is never required.

## Bug Fixes

- **An embedded deploy can no longer keep a stale firmware package** — the compatibility warning
  and the consent gate now read one plan from one runtime
  (`DeviceDeployment._computeEmbeddedOverridePlan`, logged as
  `collection-embedded-override-preflight` with `runtimeIdSource`), and the approval is enforced
  fail-closed: a shadow package whose files are not fully covered by
  `embeddedLibraryOverridePaths` aborts the deploy with
  `EmbeddedOverrideApprovalRequiredError` before anything is uploaded. Previously an empty or
  partial approval only logged `collection-library-override-package-expanded` and kept the
  firmware copy, which is how a device kept running stale `otter_vars` code
  (`TypeError: multiple values for argument 'clamp'`).
- **Equal version numbers with different bytes are detected** — the new
  `_probeEmbeddedContentMismatches()` compares the host SHA-256 of every in-use firmware-owned
  package file with `DeviceConnection.calculateHash()` and promotes a proven difference to
  `firmware-content-mismatch` (whole package shadowed, `deployment.packageContentMismatch`
  warning). The probe is capped (`EMBEDDED_CONTENT_PROBE_LIMIT`), cached per
  runtime/firmware/package/version and skipped when the connection cannot hash, so it never stalls
  a deploy or invents a mismatch.
- **New "Upload firmware package source" deploy option** — `overrideFirmwarePackages` shadows
  every in-use firmware-bundled package as a whole, always asks for confirmation (a remembered
  approval is ignored) and marks the run as forced
  (`collection-embedded-override-forced-request`, `collection-library-override-forced`). It is
  offered only while the gate would actually shadow a package (`validateNodePackages().shadowPackages`),
  and `force` keeps its own meaning — it rewrites the deployed files and generated collection code
  but never firmware-provided packages — so it never implies a shadow upload.
- **The deploy options dialog explains each option instead of one shared paragraph** — every
  checkbox now carries its own hint through the new `FormFieldDefinition.description`
  (`form-dialog__field-hint`, linked with `aria-describedby`), **Force upload** is labelled
  *Force upload (rewrite all deployed files)* because it never touches firmware-provided package
  sources, and **Upload firmware package source** only appears while
  `validateNodePackages().shadowPackages` is non-empty instead of offering an upload the plan
  would skip.
- **The toolbar Deploy button never opens the deploy options dialog** — the title-bar quick action
  keeps uploading instantly, and the dialog that does appear while the firmware's node packages
  are out of date is the shared embedded source override confirmation raised inside
  `DeviceDeployment` (confirm = upload the package sources, decline = silent cancel). When the
  fail-closed gate blocks that upload (`EMBEDDED_OVERRIDE_APPROVAL_REQUIRED`), the toolbar now
  shows a *Firmware Packages Outdated* dialog that names the affected `packageIds` and points at
  the Device tab's **Upload firmware package source** option (log
  `upload-blocked-firmware-package-override`) instead of the internal
  `Deployment blocked: …` text.
- **A stale `_dist/webapp` build is reported instead of served silently** —
  `detect_stale_static_root()` compares the build's `html/version.json` with the source tree, logs
  one warning at import time, prints the same line from `micro-otter serve`, and exposes
  `webappBuildServedVersion` / `webappBuildSourceVersion` in `GET /api/server-capabilities`. The
  static-root precedence is unchanged.
- **Honest pin-capability errors** — a node whose pin picker needs a capability the selected target
  lacks now shows one node-level `Missing required capability: <capability>` error instead of a
  misleading per-pin message, its empty pin picker is disabled, and deploy is blocked with the same
  rule. DAC is the motivating case (`dac-output` on ESP32-S3/S3 Mini); the fix also covers
  `adc-input`, `battery-monitor`, `digital-*`, the LED strip/single nodes and `i2s-*`.

## Refactor

- **The select generator and the union resolver are single-channel and tuple-aware** —
  `selectNode` emits one ternary (`out = (<true>) if bool(<condition>) else (<false>)`) instead of a
  channel loop, its `value` output declares `initialTypes` through `core.tuple`, and the union
  resolver gained the namespaced-candidate rule with matching type-compatibility tests.

## Documentation

- **Embedded override gate runbook** — `docs/dev/deployment/embedded-runtime-compatibility-deploy.md`
  documents the one-runtime preflight, the content-based shadow rule (probe cost, caching keys,
  fallback when the device cannot hash) and the manual override request;
  `docs/dev/deployment/deployment-system-architecture.md` gains the fail-closed
  *Shadow uploads require approval* invariant and the `firmware-content-mismatch` state row;
  `docs/dev/deployment/device-deployment-api.md` documents `overrideFirmwarePackages`,
  `embeddedOverrideMode`, the new approval signature and the `shadowPackages` gate that decides
  whether the option is offered; `docs/dev/view-system/view-manager.md` documents
  `FormFieldDefinition.description`.
- **Stale build warning contract** — `docs/dev/guides/build-and-deployment.md` explains what the
  `_dist/webapp` warning means and how to clear it, linked from `docs/dev/deployment/index.md`.
