# Firmware view

The Firmware tab builds MicroPython images with the node packages precompiled to `.mpy` and frozen
into the image, then flashes them. It needs the local server (`uv run micro-otter serve`); without it
the tab shows a server-unavailable panel while the rest of the editor keeps working.

Building firmware is optional. A deployed collection also runs from `.py` source uploaded by the
Deploy tab; the firmware path only lowers RAM use and boot time — see the comparison in [The app](index.md#firmware).

## Panes

| Pane | Contents |
|---|---|
| Target | board, port, chip, MCU family and flash offset of the compile mapping for the active target |
| Local firmware | the images already built or imported for this target, with details for the selected one |
| Deploy | port selection, wipe option, deploy button, image summary and deploy log |
| Build Firmware | package checklist, installed add-ons, `Build` and `Clean build`, and the build log |

Target reports `No compile mapping for this target` when the active target cannot be built; pick a
target with a board mapping before building.

## Building an image

1. Choose the runtime and target for the collection (title bar or Settings).
2. Tick the node packages the image should embed. `Minimal` ticks exactly the packages the active
   collection needs; `Select all`, `Clear` and `Refresh` manage the list.
3. Optionally tick installed add-ons to freeze them into the image as well.
4. Press `Build`. `Clean build` wipes the build directory before compiling.
5. Watch the build log; the artifact row reports runtime version, package count, size, publish status
   and warnings, and `Copy path` copies the artifact path.

The tab tells you when a firmware for exactly that package selection already exists, or when an
existing image is a superset of it — in both cases a rebuild adds nothing.

| Package row note | Meaning |
|---|---|
| `Missing capabilities: …` | the target lacks a capability the package needs; the row cannot be ticked |
| `Optional` | the package is not required by the collection |
| `Add-on` | the row comes from an installed add-on |
| `Runtime-local packages are not staged` | the package lives inside the runtime and cannot be frozen |

Build errors are reported per cause, for example `compile-disabled` when the server has compilation
turned off, `noTarget` when the runtime has no buildable platform, or `package-not-staged`.

## Install an addon

An add-on is a node package installed into the app rather than shipped with it. Installed add-ons are
listed in `Build Firmware` → `Installed add-ons`, and a ticked add-on is compiled into the image
exactly like a shipped package.

1. Press `Install add-on` to pick a `.zip` on the server's machine, or `Install from URL…` to name an
   `https://` URL the server fetches itself.
2. Tick the add-ons the next build should embed; `Select all`, `Clear` and `Refresh` manage the list and
   the count reads `<selected> of <total> selected`.
3. Press `Remove` to uninstall the ticked rows — the tab asks for confirmation first.

The palette gains an installed package's node types as soon as the install finishes. Authoring a
package, its archive limits and the command-line equivalents are described in
[Add-ons](../addons/index.md).

## Deploying firmware

| Field | Meaning |
|---|---|
| Port | serial port to flash; `Rescan serial ports` refreshes the list |
| Wipe filesystem | erases the device filesystem before flashing; this deletes user data |
| Deploy | flashes the selected image |

Deploy uses the firmware from the last successful build, the image selected in Local firmware, or the
newest available image — the pane states which one. If the app is connected to that port, Deploy
releases the connection first; reconnect afterwards from the cable badge in the title bar.

The summary shows board, chip, port, image, size and SHA-256, and the deploy log records the flashing
output. A board without a flash backend reports `This board cannot be flashed`.

## Local firmware inventory

Each image row reports its firmware version, MicroPython version, runtime, target, hash, channel and
size, with badges for `latest`, `new`, `Release` / `Dev`, `add-ons included` and package coverage
(`complete` / `partial` / `unknown`). The details pane lists the embedded packages with versions and
variants.

| Action | Effect |
|---|---|
| Refresh | re-reads the image list for the target |
| Import | imports a `.firmware.zip` or `.bin`; because the image carries no runtime you choose the platform it is imported for, then install the runtime from the Deploy tab |
| Import from URL… | asks the server to fetch an `https://` URL (plain `http` only towards this machine) |
| Export | writes the image package to a folder on the server machine |
| Delete | removes the image after confirmation |

Importing an image that already exists asks before replacing it, and an imported image is reported
with its filename and platform.

## Related

- [Add-ons](../addons/index.md) — installing packages the firmware can embed.
- [Deploy view](deploy-view.md) — uploading a collection once the firmware is flashed.
- [Console and output](console-view.md) — serial output after flashing.
