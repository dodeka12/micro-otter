# Deploy view

The Deploy tab sends the active collection to the connected device and reports what the device is
running. It needs a connected device; without one the tab only shows a Help panel pointing at the
cable badge in the title bar.

## Before the first deploy

1. Connect the device with the cable badge — see [Device view](device-view.md).
2. Make sure the device has a target; on first contact the app asks which target the device is.
3. Install a runtime if the Deploy tab reports `No Runtime Detected`.

Without a target the app cannot validate the collection's pins and capabilities; a mismatch between
the collection's target and the device's target is reported as a deployment error instead of being
deployed.

## Deployment actions

| Button | What it does |
|---|---|
| Install Runtime / Upgrade Runtime | opens a runtime picker when no runtime is installed, or re-installs the installed runtime at a newer version |
| Remove Runtime | deletes the runtime files from the device |
| Refresh Device Info | re-reads connection, MicroPython, runtime, target and library state |
| Edit Device Target | changes the target recorded for this device |
| Deploy Collection | uploads the active collection after checking compatibility; unchanged files are skipped |
| Sync Collection | uploads the active collection without the compatibility check and without `Force upload` |
| Remove Collection | deletes the collection code and metadata from the device |

The collection buttons stay disabled until a runtime is installed, and `Remove Collection` also needs
a collection to be deployed. `Deploy Collection` reports `No Runtime Detected` when the runtime is
missing.

Deploy checks that the collection's target matches the device's target before it uploads anything and
stops with a message naming both targets when they differ. Sync trusts the earlier check.

## Deploy or sync?

Both buttons upload the collection and both skip files whose content has not changed.

|  | Deploy Collection | Sync Collection |
|---|---|---|
| Compatibility check | yes, target must match the device | no, run it after a successful deploy |
| Options dialog | `Force upload` and `Include full collection definition` | `Include full collection definition` |
| Force upload | rewrites every file of the deploy | not offered |
| Typical use | first upload, new runtime, target or package changes | small edits on a working device |

`Force upload` rewrites the collection code, its metadata and every library source uploaded as
source, even when the content matches. Use it when the device keeps running old code after a deploy
that reported no changes.

The title bar's Deploy button runs the same deploy without opening the Deploy tab: it skips the
options dialog but still asks for consent when firmware package source has to be uploaded. If the
upload needs a package-source override that only the Deploy tab's options can grant, the quick
action stops and names the packages instead of silently uploading outdated code.

### Options

| Option | Effect |
|---|---|
| Include full collection definition | also stores the complete graph structure on the device, so the collection can be downloaded back later |
| Force upload (rewrite all deployed files) | Deploy only; see above |
| Upload firmware package source | separate consent dialog, shown by Deploy and Sync; see below |

### Packages and the firmware

The device runs node packages either from its firmware (fast, low RAM) or from source files uploaded
into the collection.

| Situation | Decision | What deploy does |
|---|---|---|
| Package bundled in the firmware, versions match | `available-embedded` | nothing is uploaded; the firmware copy is used |
| Package missing from the firmware | `missing` | the package's **source is always uploaded** |
| Firmware copy older than the host copy, or missing files, or different content | `override-required` | you are asked whether to upload source; the dialog lists each package with its firmware and host versions |
| Package not available on the host at all | — | deploy stops and names the missing file |

Equal version numbers do not prove equal bytes: the deploy probes the firmware-owned files and
re-asks when the content differs. The device log records each choice as
`collection-library-decision` with its `decision` value.

Uploading package source always works — it does not depend on the firmware image — but it costs RAM
and can fail on a small device, so the dialog recommends updating the firmware instead. Choosing
`Remember for this version` keeps the decision for that firmware version until the device is
updated.

### Deploying while the collection runs

Deploy does not need the program to be stopped. After the files are written the device is soft-reset,
and if the collection was running before the deploy it starts running the new code again by itself.
With no changed files there is no reset and no restart.

### Removing a collection

`Remove Collection` asks for confirmation, then deletes the collection code and its metadata. The
runtime and other files on the device are left alone.

## Managing the runtime

| Action | Dialog |
|---|---|
| Install | choose one of the bundled runtimes from a dropdown |
| Upgrade | confirm the version change; `Preserve collection data` is on by default |
| Remove | confirm, then optionally `Delete preserved files` and `Delete entire filesystem` |

`Upgrade` re-installs the runtime; with `Preserve collection data` on, the deployed collection's data
survives the re-install. `Delete entire filesystem` on removal wipes everything on the device,
including your own files and the collection.

Install and Remove are unavailable when the device runs Micro-Otter **firmware**, because the runtime
is already embedded in it; the button tooltip reports this. In that case update the firmware image
instead — see [Firmware view](firmware-view.md).

## What the panes show

| Section | Contents |
|---|---|
| Device Information | connection state, MicroPython presence and version, target, description, libraries on the device |
| Runtime Information | installed runtime, mode (Dynamic or Embedded), name, version, firmware versions, embedded packages, node packages with versions |
| Collection on Device | the collection currently deployed and whether it carries the full graph |
| Collection Comparison | local collection beside the device collection, with a compatibility status and Download Collection from Device |

If the runtime mode cannot be read, the tab asks whether to retry detection; deployment stays blocked
until the mode is known.

## Downloading a collection from the device

`Download Collection from Device` reads the collection deployed on the device back into the editor.
It requires that the collection was deployed with `Include full collection definition`; if a local
collection with the same ID exists, you are asked before it is overwritten.

## Related

- [Firmware view](firmware-view.md) — building an image that already contains the packages.
- [Device view](device-view.md) — connecting and running the collection.
- [Console and output](console-view.md) — deploy progress and errors.
