# Installation

The `mo addons` command group validates, installs, lists, and removes add-ons. Installation is
**structural validation only** — there is no registry lookup, signature verification, or version
resolution.

```bash
mo addons install ./my-nodes.zip              # install, or fail with addon-already-installed
mo addons install ./my-nodes.zip --force      # replace an existing install with the same id
mo addons install ./naked-archive.zip --as my_nodes   # archive whose manifest.json is at the root
mo addons install ./my-nodes-checkout/        # a directory installs a copy
mo addons install --url https://example.com/my-nodes.zip   # the CLI fetches the URL itself
mo addons package ./my-nodes-checkout/ -o ./my-nodes.zip  # reproducible archive (deterministic)
mo addons list [--json-output]
mo addons uninstall my_nodes
mo addons validate ./my-nodes.zip             # structure only — writes nothing
```

`mo addons package` turns a validated package directory into a **reproducible** archive (fixed
timestamps, sorted members, fixed mode), so two runs over the same tree produce byte-identical
`.zip` files; the CLI validates the tree first with the same `addon-*` rules `install` uses. Every
member is stored under `<folder>/`, the same layout a plain `zip -r` produces — so the result
installs without `--as`. Editor/OS caches (`.DS_Store`, `Thumbs.db`, `__pycache__`) are skipped.
An `addons install --url` is fetched by the **CLI**, never the browser, under the same policy the
server applies (https always; `http` only towards loopback).

**Package it yourself** — each of these produces an archive that installs without `--as`:

```bash
cd examples/addons/node_pkgs && zip -r pulse.zip pulse          # pulse/manifest.json inside
git archive --prefix=pulse/ -o pulse.zip HEAD:examples/addons/node_pkgs/pulse
```

Finder's *Compress* and Explorer's *Send to → Compressed (zipped) folder* on the folder also work;
macOS `zip -r` can add a `__MACOSX/` metadata directory, which the installer ignores. Archiving from
*inside* the folder (`cd pulse && zip -r ../pulse.zip .`) puts `manifest.json` at the root and needs
`--as`; stray files inside the folder are installed as-is, which is why `mo addons package` is the
cleaner route for a published archive.

Rules:

- **The manifest `id` is authoritative** — the installed folder is always `<addons_dir>/<id>`.
- **Layout** — the archive must hold `<folder>/manifest.json`, or `manifest.json` at the root plus
  `--as <id>`; a single top-level folder is stripped. `mo addons package` emits the former, matching
  `zip -r`.
- **Limits** — ≤ 64 MiB archive, ≤ 2000 entries, ≤ 128 MiB unpacked. The server resolves the archive
  and enforces the file cap (`addon-archive-too-large` from a path, or `archive-url-too-large` for a
  URL body) before opening it, and bounds the extracted tree with `addon-archive-unpacked-too-large`;
  the 128 MiB unpacked figure is the limit a package actually reaches.
- **Refused members** — absolute paths, `..`, backslashes, symlinks, duplicate names.
- **Every other file travels** — there is no file allowlist, so a package's `LICENSE`, `README.md`, or
  `icons/` folder is installed next to its manifest and archived by `mo addons package` unchanged.
- **One rename** — extraction happens in `.staging/`, is validated there, and is published with a
  single `os.replace`; a crash never leaves a half-installed package.
- **Built-in ids are immutable** — `addon-id-conflicts-builtin` is raised before anything is moved.

## From the Firmware tab

The same two operations are available in the web app, without leaving it:

1. Open the **Firmware** tab and expand **Build Firmware → Installed add-ons**.
2. Press **Install** to pick a `.zip` archive on the server's machine, or **Install from URL…** to
   name an `https://` URL. The server resolves the archive itself — the client never uploads bytes,
   and a URL is fetched by the server, not the browser — and the resulting table refresh is how the
   package becomes selectable in the package checklist.
3. Press **Remove** to uninstall the ticked rows; the tab asks for confirmation first.

The table is the client's view of `addon_inventory_payload()`, and the selectable packages come from
two requests the backend synthesizes: the merged index at `/device/node_pkgs/index.json` and
`nodePackages.addons` in `/device/runtime/<id>/manifest.json`. A client on the Vite dev origin sees
those only through the `dev:web` proxy — see
[build-and-deployment.md](../../guides/build-and-deployment.md).

Two limits a person will hit: the 64 MiB archive cap, and one id per folder — installing an id that
already exists answers `addon-already-installed`, and the tab offers to replace it (a second
`addon.install` with `force: true`). See
[firmware-build-websocket-protocol.md](../../firmware-compile/firmware-build-websocket-protocol.md#addoninstall)
for the frame fields and the result payload.

The editor follows the same move. A successful install or uninstall reloads the runtime collection in
place and emits `runtimesLoaded` (`RuntimeCollection.RuntimesLoaded.v1`), so the palette gains or
drops the package's node types and the graph re-validates its nodes without a page reload. A node
whose package is gone keeps its place in the graph, painted with the capability-error border; the
hover tooltip carries `graph.nodeTypeMissing` and names the package to install. Reinstalling it clears
the issue on the next reload.

## Licence

An add-on is redistributed code, so a package ships its own `LICENSE` beside `manifest.json`. The
installer, `mo addons package`, and `mo addons validate` copy the tree verbatim — no manifest entry
lists files — so the licence lands in `<addons_dir>/<id>/` and inside any archive you build. The
`hello` and `pulse` examples ship the repository `LICENSE` (GPL-3.0-only) byte-identically and repeat
the statement in each node's `info` text, which is what **Show Information** shows.

## Stable error codes

Printed by the CLI, carried in `--json-output`, and unchanged across releases. The same 22 codes are
the `.error.code` values of the `WS /firmware` `addon.install` / `addon.uninstall` jobs
([wire contract](../../firmware-compile/firmware-build-websocket-protocol.md#error-codes)), where the
Firmware tab renders each one as a translated sentence instead of the raw server message:

| Code | Meaning |
|------|---------|
| `addon-archive-not-found` | The source path does not exist. |
| `addon-archive-invalid` | The file is not a readable `.zip`. |
| `addon-archive-too-large` / `-too-many-entries` / `-unpacked-too-large` | Size/member limits. |
| `addon-archive-unsafe-path` / `-symlink` | Unsafe member. |
| `addon-archive-no-manifest` | No package folder with `manifest.json`. |
| `addon-manifest-invalid` / `-missing-version` / `-missing-asset` / `-forbidden-asset` | Manifest problems. |
| `addon-module-root-invalid` | An `mpAssets` path is not under `moa_<id>` / `moa_<id>_<variant>`. |
| `addon-variant-manifest-invalid` / `-capabilities-missing` / `-hardware-missing` / `-precedence-duplicate` | Variant problems. |
| `addon-layout-legacy-variant-manifest` | The package carries a `manifest.<variant>.json`; declare variants under `variants` in `manifest.json`. |
| `addon-id-invalid` / `-mismatch` / `-conflicts-builtin` | Id problems. |
| `addon-already-installed` / `addon-not-installed` | Install/uninstall state. |

A base manifest may **name and describe** its default implementation (`variantTitle`/
`variantDescription`) but may not declare `variant`, and the reserved id `py` cannot be declared by a
variant manifest either (`manifest.py.json` or `variant: "py"` is refused as
`addon-variant-manifest-invalid`).

Installing or uninstalling changes local inventory only — firmware images, device filesystems, and
the deploy decision are untouched until the next build.

## One inventory payload

`mo addons list --json-output` and the Firmware tab's `addon.install` / `addon.uninstall` jobs all
report [`addon_store.addon_inventory_payload()`](../../../../src/micro_otter/tools/addon_store.py):
`addons` (one row per installed package with `id`, `version`, `name`, `variants`, `moduleRoots`,
`packageDir`, `provenance`, `installedAt`), `conflicts` (folders that shadow a built-in id), and
`warnings` (the same two families as human-readable lines). The job result frames add `installed` /
`removed` beside it, so a client decodes one shape for every add-on mutation. See
[firmware-build-websocket-protocol.md](../../firmware-compile/firmware-build-websocket-protocol.md#addoninstall).
