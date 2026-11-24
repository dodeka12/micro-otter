# Add-ons

An add-on is a node package installed into your own folder instead of shipping with Micro-Otter. It
adds its node types to the palette, appears in the Firmware tab, and is compiled into a firmware image
exactly like a built-in package.

## What an add-on contains

| Part | File | Holds |
|---|---|---|
| Manifest | `manifest.json` | `id`, `version`, the `variants`, and every device file the package ships |
| Node definitions | `node_definitions.json` | the node types with their ports and controls |
| Generators | `node_generators.js` | the MicroPython each node emits |
| Device module | `moa_<id>/…` | the MicroPython the nodes import at runtime |
| Licence and readme | `LICENSE`, `README.md` | copied verbatim — nothing filters package files |

Authoring detail is in [Create a package](create-package.md).

## Where add-ons live

| Setting | Value |
|---|---|
| Folder | `<addons_dir>/<id>/` — one folder per package, named after the manifest `id` |
| Default | `~/.micro-otter/addons` |
| Environment | `MICRO_OTTER_ADDONS_DIR` |
| `micro-otter.toml` | `addons_dir = "~/my-addons"` |

The folder is separate from the packages that ship with Micro-Otter, and an add-on that reuses a
built-in id is refused (`addon-id-conflicts-builtin`).

## Install from the command line

| Task | Command |
|---|---|
| install an archive | `uv run micro-otter addons install ./my-nodes.zip` |
| replace an installed id | `uv run micro-otter addons install ./my-nodes.zip --force` |
| archive with `manifest.json` at its root | `uv run micro-otter addons install ./naked.zip --as my_nodes` |
| install a folder (copies it) | `uv run micro-otter addons install ./my-nodes-checkout/` |
| install from a URL | `uv run micro-otter addons install --url https://example.com/my-nodes.zip` |
| check a package without writing | `uv run micro-otter addons validate ./my-nodes.zip` |
| list what is installed | `uv run micro-otter addons list` |
| remove | `uv run micro-otter addons uninstall my_nodes` |

`mo` is the short alias for `micro-otter`. A URL is fetched by the command itself, never by the browser:
`https` always works, plain `http` only towards this machine.

## Install from the Firmware tab

1. Open the Firmware tab and expand `Build Firmware` → `Installed add-ons`.
2. Press `Install add-on` to pick a `.zip` on the server's machine, or `Install from URL…` to name an
   `https://` URL the server fetches itself.
3. Tick the add-ons the next image should embed; `Select all`, `Clear` and `Refresh` manage the list.
4. Press `Remove` to uninstall the ticked rows — the tab asks first.

An empty table reads `No add-ons installed`. Without the `node-package-addons` capability the section
lists nothing, and `Install add-on` additionally needs `local-file-access`.

## What installing changes

- The palette gains the package's node types as soon as the install finishes — no page reload — and the
  package list badges its rows `Add-on`.
- A node whose package is gone keeps its place in the graph with the capability-error border; the
  tooltip names the package to install, and reinstalling it clears the issue.
- Firmware images and the device are untouched until the next build or deploy.

## Limits

| Limit | Value |
|---|---|
| Archive size | 64 MiB |
| Archive entries | 2000 |
| Unpacked tree | 128 MiB |
| Refused members | absolute paths, `..`, backslashes, symlinks, duplicate names |
| Ignored | a macOS `__MACOSX/` folder; `mo addons package` also skips `.DS_Store`, `Thumbs.db`, `__pycache__` |

## Related

- [Create a package](create-package.md) — manifest, node definitions, packaging, testing.
- [Firmware view](../app/firmware-view.md) — building an image with add-ons ticked.
- [Node reference](../nodes/index.md) — documenting the nodes a package adds.
