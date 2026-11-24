# Embedded Runtime Setup API Deploy

**Status:** Implemented Behavior  
**Scope:** Runtime deploy action behavior when runtime mode is embedded.

## Purpose

Define runtime deploy semantics for embedded firmware mode, where full runtime
filesystem upload is not valid and bootstrap setup is handled by firmware APIs.

## Trigger

Embedded setup route is selected when API-based runtime detection reports:

- `runtime.mode == "embedded"`

If metadata API detection fails or is unavailable, host routing falls back to
default dynamic runtime deploy behavior.

## API-Only Embedded Setup Flow

When runtime upgrade/refresh is requested in embedded mode:

1. Host calls `apply_bootstrap_setup()` via `DeviceConnection.executeCode(...)`.
2. Host validates setup payload (`schemaVersion`, `ok`, `results`, `errors`).
3. Host aborts on setup errors and surfaces setup result details to the UI.
4. Host calls `refreshDeviceInfo()` on successful setup.
5. Host emits completion events for existing listeners.

No host-side composition/writes of embedded bootstrap files are performed.

## Setup Result Contract

Expected file action entries include canonical writable paths:

1. `/manifest.json`
2. `/device.json`
3. `/app/main_loop.py`

`/device/targets/active_target.json` is not a setup path: firmware never writes target content, and
the app is its only writer (`DeviceDeployment._uploadTargetConfiguration`).

The `/device.json` identity block (`constituentVersions`) is where a driver reads the frozen
composition: `nodePackages`, `addonPackages`, `runtimeAssetsVersion` and — for an image built since
M4v — `frozenAddons`, a `packageId → { variant, version }` map that is omitted when the image froze
no add-on. `firmwareConstituentVersions.frozenAddons` therefore answers "which implementation is
on this device?" the same way `nodePackages` answers "which version?". Firmware-bundled packages
include add-ons: `resolveFirmwareBundledPackageIds()` unions the built-in package ids with the
keys of `addonPackages` and `frozenAddons`, so a frozen add-on is never warned as "not bundled".

When runtime metadata declares `customView`, setup additionally includes that
runtime view file path (for example `/custom_view.json`).

Action vocabulary:

1. `created`
2. `updated`
3. `unchanged`
4. `error`

Errors are returned with categories (`validation`, `filesystem`, `runtime`, `unknown`).

## Events and Status

Embedded setup route emits:

1. `runtime-embedded-compatibility-deployed`
2. `runtime-upgraded`

`runtime-embedded-compatibility-deployed` payload includes:

1. `operation` (`upgrade` or `refresh`)
2. `runtimeId`
3. `source` (`api` or `fallback`)
4. `files` (paths touched by setup API)
5. `setupResult` (normalized `apply_bootstrap_setup()` response)

## Outdated Package Detection

"Which firmware-bundled package is older than the host copy?" is answered in exactly one place:
`DeviceDeployment._computeEmbeddedOverridePlan(collection)`.

It resolves **one** runtime (`_resolveEmbeddedPlanRuntime()`: the connected device's runtime id
first, the collection's declared runtime id second), computes the firmware module plan from it, and
returns the shadow set as entries carrying `packageId`, `deviceVersion`, `hostVersion` and
`reason`. Both consumers read that preflight, so a warning and an upload cannot drift:

1. `validateNodePackages()` turns `shadowPackages` into display-only warnings.
2. The consent gate (`_resolveEmbeddedSourceOverrides()`) turns the same entries into the
   deploy-time source override plan that may upload host sources over the firmware copies.

Every run logs `collection-embedded-override-preflight` with `runtimeId`, `runtimeIdSource`
(`device-state` or `collection`), `collectionRuntimeId`, `runtimeEmbedded`, `fileCount` and the
per-package `reason` plus both versions, so "the warning said one thing and the upload did
another" is visible in the log instead of being silent.

When the device exposes **no** package version source at all (`embeddedPackagesSummary` and
`firmwareConstituentVersions.nodePackages` both missing), every firmware-bundled package in use is
reported as outdated with `deviceVersion: 'unknown'` (`UNKNOWN_DEVICE_VERSION`). Shadowing is then
the only choice that cannot produce a broken import: without version knowledge the deployment
cannot prove that the firmware copy is current, and guessing "current" is what leaves a device with
neither a working firmware copy nor a user-space copy. The consent dialog still runs, so the upload
is never silent.

Consumers never print the sentinel verbatim — they localise it:

- `deployment.packageVersionUnknown` for the `validateNodePackages()` warning,
- `deployment.embeddedOverridePackageLineUnknown` for the consent dialog line.

`null` is reserved for "no runtime resolves at all". Outside embedded mode the gate then keeps the
legacy behaviour; in embedded mode it is an error — `validateNodePackages()` reports
`Cannot resolve the embedded runtime: <id>` and the deploy throws instead of uploading nothing and
leaving the firmware's frozen copy in place.

Only packages that some node of the collection actually uses are considered outdated, and
`requiredPackages` are expanded first, so a dependency pulled in by an in-use package is
covered too. Unparsable version strings are treated as "not outdated", which keeps a
malformed manifest from ever triggering an override upload.

### Whole-Package Invariant

The asset keys a collection uses decide *whether* a package is outdated, never *which files*
are shipped. `_collectPackageAssetPaths(nodePackage)` walks **all** `mpAssets` entries of an
outdated package, so the override plan contains the complete package.

The reason is MicroPython's import machinery: a package's submodules are searched only inside
the directory of the package that won the import (`__path__`). A partial shadow copy therefore
hides the firmware copy *and* breaks every submodule that was not uploaded, which surfaces as
the original `ImportError` even though a file was written. Override deploys are consequently
larger than the used-asset set by design.

### Content-Based Staleness (Same Version, Different Bytes)

Equal version numbers are not proof of equal bytes: a firmware image built from a different
revision of the same package version string keeps its frozen copy on the device, and a
version-only comparison would keep the stale code there (`TypeError: multiple values for argument
'clamp'` is one symptom).

`DeviceDeployment._probeEmbeddedContentMismatches(collection, runtime, plan)` runs before the
consent dialog and covers exactly the packages the plan calls `firmware-current` **and** the
firmware owns (`plan.firmwareOwnedPackageIds`), restricted to the packages the graph uses:

1. Only files the device inventory lists as `source: 'embedded'` are considered.
2. The host content is fetched through `CollectionDeployment.resolveLibraryUrl()` and hashed with
   SHA-256; the device copy is hashed with `DeviceConnection.calculateHash(path)`.
3. One differing file promotes the whole package to `firmware-content-mismatch`: the dialog names
   it (`deployment.embeddedOverridePackageLineContent`), `validateNodePackages()` warns with
   `deployment.packageContentMismatch`, and the complete package is uploaded as source.

Everything else stays conservative:

- a probe error is logged as `embedded-content-probe-error` and never invents a mismatch;
- a connection without `calculateHash`, or a missing `embeddedInventory`, skips the probe with
  `embedded-content-probe-skipped` and keeps the version + inventory verdict;
- one run is capped by `EMBEDDED_CONTENT_PROBE_LIMIT` (24 device hashes) and logs
  `embedded-content-probe-limit`, so a large package cannot stall a deploy behind a slow link; a
  capped package is not cached;
- verdicts are cached per
  `runtimeId|firmwareFullVersion|packageId|deviceVersion|hostVersion` in
  `_embeddedContentProbeCache`, and the cache is cleared on connect/disconnect exactly like the
  remembered approvals, so a second deploy of the same session costs no device hash.

The version rule still wins: a firmware that is *older* stays `firmware-outdated` even when its
bytes happen to match, because the host copy is then the newer source of truth.

### Manual Override Request

Some firmware images ship a package under the same version string but with code the host must
replace regardless of what the plan concludes — or the plan has no evidence at all. Whenever the
preflight would shadow at least one package, the deploy and sync options dialogs offer **Upload
firmware package source** (`deployment.overrideFirmwarePackages`) with the hint
`deployment.overrideFirmwarePackagesHint` under the checkbox. The option is hidden while the
firmware's packages are all current, because there would be nothing for it to replace — the view
gates on `validateNodePackages(collection).shadowPackages`, the same preflight the gate consumes.
A same-version content mismatch proven by the device probe *after* the dialog is still safe: the
consent dialog always asks before a shadow upload, so the hidden checkbox never implies "no
shadow".

Ticking it sets `overrideFirmwarePackages: true` on `deployCollection()` /
`syncCollectionFiles()` and makes the gate shadow **every in-use firmware-bundled package** as a
whole:

- the reason is `forced-override`, so the dialog line is
  `deployment.embeddedOverridePackageLineForced` and the gate logs
  `collection-embedded-override-forced-request`;
- the confirmation dialog is always shown — a remembered approval is ignored, because the user
  asked for this specific run;
- declining throws `EmbeddedSourceOverrideDeclinedError` and nothing is uploaded;
- `CollectionDeployment` still enforces the complete path list and logs
  `collection-library-override-forced`, so the run is auditable.

It costs RAM: the uploaded source replaces the firmware copy in user space, so use it to bridge a
stale image, not as a permanent mode. `force` (**Force upload**) stays independent — it rewrites
the generated collection code, its metadata and every source-uploaded library (the dialog says so
through `deployment.forceUploadHint`), but never the firmware-provided packages, so it never
implies a shadow upload.

### Non-firmware Packages

A collection may use a node package the firmware does not bundle at all (`id` not listed in
`runtime.nodePackagesGlobal`). In embedded mode its source is uploaded into user space, which is
the correct behaviour — there is no firmware copy to fall back on.

It is not free: the device's RAM was sized for the firmware's own package set, so the main loop can
fail with a memory error after the deploy. `validateNodePackages()` therefore emits one
display-only `deployment.packageNotInFirmware` warning per such package (`{{packageId}}`), derived
from the packages that actually contribute library files. It never sets `compatible: false` and it
is not emitted in dynamic mode, where uploading every package as source is the normal case.

## Redeploy Behaviour

Once a source override is on the device, the next deploy of an unchanged collection must not disturb
it. The deployment pattern behind that guarantee — *complete plan, subtractive removal* — is
described in
[Deployment System Architecture → Deploy Pattern](./deployment-system-architecture.md#deploy-pattern-complete-plan-subtractive-removal).

### What a normal redeploy does

- `HashManifestManager.getFilesToUpload()` returns nothing, because every staged hash matches the
  manifest. **No file content is uploaded.**
- Every override file is still part of the prepared plan (`decision: "override-required"`), so the
  stale subtraction (`manifest − plan`) yields nothing and nothing is deleted.
- The device keeps running the shadowed package.

### What "correct" looks like in the log of a second deploy

```
collection-library-decision  action=upload  path=otter_vars/arrays.py  decision=override-required
```

- `decision` is `override-required` for the overridden package files — never a skip.
- No `collection-file-removed` for those paths.
- No `controller-main-loop-load-failed` on the device afterwards.

### The two legitimate removals

| Removal | How to recognise it |
|---|---|
| Firmware caught up | `collection-file-removed` for the shadow **and** the package version present in `embeddedPackagesSummary`; the files still needed are skipped as `available-embedded` and are listed in `embeddedInventory.files`, so the guard stays silent. |
| Package no longer used | `collection-file-removed` for the package's paths with **no** firmware entry for them; the graph no longer references the package, so nothing is a candidate library. |

A third, coarser removal runs in the same place: once the firmware owns the whole package
(`collection-firmware-owned-package-folders`), `_removeStaleLibraryFolders()` deletes the package
folder recursively — including files no hash manifest ever recorded — and logs
`collection-library-folder-removed`. That removal is a device change, so the deploy still
soft-resets. See
[Deploy Pattern: Complete Plan, Subtractive Removal](./deployment-system-architecture.md#deploy-pattern-complete-plan-subtractive-removal).

### Symptom: `ImportError: no module named '<pkg>.<sub>'`

The device reports `ImportError: no module named 'otter_vars.arrays'` (or any other
`<package>.<submodule>`) while no user file of that package should exist any more.

**Cause.** MicroPython searches the VFS before the frozen modules, and a package's submodules are
resolved only inside the directory that won the import (`__path__`). A leftover `otter_vars/` — even
an *empty* one — therefore wins `import otter_vars`, and the next submodule import fails. Such a
folder survives when the deploy only ever removed individual files, because the per-file
subtraction can only name paths the hash manifest enumerates.

**Fixed behaviour.** A deploy with the firmware current for the package removes the whole folder in
one device call and soft-resets. Look for `collection-firmware-owned-package-folders` followed by
`collection-library-folder-removed` with `removedEntries > 0`.

**Recovery for devices left behind by older firmware or tooling:**

1. Re-read the device info so `embeddedInventory` is populated (the folder removal needs proof that
   the firmware can replace every file).
2. Inspect the device in the REPL: `import os; print(os.listdir())`.
3. Remove the empty remnants deepest first:
   `os.rmdir('otter_vars/subpkg')` … then `os.rmdir('otter_vars')`. A non-empty folder must be
   emptied first (`os.listdir` + `os.remove`) — or simply deploy again, which now removes the whole
   folder once the firmware owns it.
4. Reset the device (`machine.reset()`) so the module search path is rebuilt.

### If an override disappears after a second deploy

1. Look for `decision: "available-dynamic"` in the deploy log — that is the pre-fix code path
   (manifest entry treated as "already on device, do not plan"). Builds with that value still contain
   the bug.
2. Look for `collection-library-stale-keep-firmware-missing`. If it appears, the guard fired and
   *kept* a file; the cause is an unreadable or stale `embeddedInventory`, not a lost override.
3. Check whether `embeddedInventory` is populated at all. If the device info was never read (or the
   read failed), the inventory is `null`; re-read the device info before the next deploy so the
   guard and the availability decisions work on real data.

### Related fallbacks

- Firmware that reports **no** package versions at all does not fall back to "trust the firmware":
  every in-use firmware package is shadowed with the `unknown` sentinel version. See
  [Outdated Package Detection](#outdated-package-detection).
- Packages the firmware does not bundle are uploaded as source and reported as
  `deployment.packageNotInFirmware`, because the extra RAM can break the main loop. See
  [Non-firmware Packages](#non-firmware-packages).

## Onboarding target backstop

The connected board's firmware answers "which targets can this board onboard?" via
`target.buildBaseTargetId` (M4x) — the terminal build base id the image was built against. The host
resolves a collection/device target's base id and compares it; a mismatch is refused before upload
(`target-not-compatible`). Images built before M4x carry only `target.allowedWebTargetIds`, which the
host expands through the target resolver to base ids; images with neither field fall back to board
comparison, then to "allow". The device-side onboarding predicate still enforces its own
`targetConstraints.allowedTargetIds` list — a stale or tampered client therefore cannot force an
incompatible target upload. This gates *targets only*; the `missing` / `override-required`
source-upload path above is unchanged.

## Related

- `src/micro_otter/nodes/html/js/deployment/device-deployment.ts`
- `docs/dev/deployment/device-deployment-api.md`
- `docs/dev/firmware-compile/embedded-metadata-api-contract.md`
