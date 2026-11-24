# Create a package

An add-on is a folder holding a manifest, node definitions, a generator and its MicroPython device
module. This page takes that folder from a checkout to an archive another person can install.

## Folder layout

```text
my_nodes/
├── manifest.json            # required — identity, version, variants, declared files
├── node_definitions.json    # the node types, with their ports and controls
├── node_generators.js       # turns each node into MicroPython
├── node_capabilities.js     # optional — per-node capability checks
├── data_types.json          # optional — connector type metadata
├── icons/…                  # optional — the SVG a node definition names
├── moa_my_nodes/…           # the device module, in the reserved namespace
└── LICENSE
```

## The manifest

| Field | Required | Meaning |
|---|---|---|
| `manifestVersion` | yes | `2`. |
| `id` | yes | package id — lowercase letters, digits and underscores, starting with a letter; also the installed folder name |
| `version` | yes | non-empty string, shown beside the package and compared when replacing an install |
| `variants` | yes | one entry per implementation |
| `nodeDefs` | no | node-definition file, default `node_definitions.json` |
| `generators` | no | generator files the editor loads, default `node_generators.js` |
| `capabilityChecks` | no | capability-check file |
| `name`, `description` | no | `{ "en": …, "de": … }` texts for the package list |

| Variant field | Required | Meaning |
|---|---|---|
| `mpAssets` | yes | device files — `"*"` ships them always, a node-type key ships them only when that node is used |
| `title` | no | label in the variant picker |
| `requiredCapabilities` | no | capabilities the target must offer |
| `precedence` | no | picker order only; it never selects a variant |
| `description`, `hardware` | no | tooltip texts |

```json
{
    "manifestVersion": 2,
    "id": "my_nodes",
    "version": "1.0.0",
    "nodeDefs": "node_definitions.json",
    "generators": ["node_generators.js"],
    "variants": {
        "py": {
            "title": { "en": "Py", "de": "Py" },
            "mpAssets": { "*": ["moa_my_nodes/__init__.py"] }
        }
    }
}
```

The variant id `py` is the default implementation and any other id is an alternative (`viper`,
`native`, …). One manifest per package — a `manifest.<variant>.json` file is rejected.

## The device module namespace

| Prefix | Belongs to | Example |
|---|---|---|
| `otter_*` | packages shipped with Micro-Otter | `otter_led` |
| `moa_*` | add-ons | `moa_my_nodes` |

- The first path segment of every `mpAssets` entry must be `moa_<id>` (variant `py`) or
  `moa_<id>_<variant>`; anything else is refused with `addon-module-root-invalid`.
- The namespace only decides where the module is staged — the node type in a graph is still
  `<id>.<type>`, for example `my_nodes.greet`.
- A generator shared by several variants cannot know which module was staged, so emit a guarded import
  (`try: import moa_my_nodes as _nodes` / `except ImportError: import moa_my_nodes_viper as _nodes`) or
  re-export one API name from every variant.

## Node definitions

- One `node_definitions.json` per package; every variant implements the same node ids, ports and
  controls.
- A node type id becomes `<id>.<type>`; `title` and `info` are `{ "en": …, "de": … }` maps.
- `implementations` and `initImplementations` name the generator functions. Each generator file
  registers them on `NodeCodeGenerators` for the loop body and `NodeInitGenerators` for the init phase.
- Per-port and per-control `description` texts are what `Show Information` displays.
- Document the new nodes the way the [node reference](../nodes/index.md#node-page-template) lays them
  out: one page per node, file name equal to the node id.

## Packaging

`mo addons package` writes a reproducible archive — fixed timestamps, sorted members, fixed mode — so
two runs over the same tree are byte-identical.

1. Validate the folder: `uv run micro-otter addons validate ./my_nodes`.
2. Build the archive: `uv run micro-otter addons package ./my_nodes -o ./my_nodes.zip`.
3. Publish or hand over `./my_nodes.zip`; it installs without `--as`.

Every member sits under `<folder>/`, the layout `zip -r my_nodes.zip my_nodes` produces. An archive
built from inside the folder has `manifest.json` at its root and needs `--as` on install.

| Tolerance | Detail |
|---|---|
| Archive size | 64 MiB |
| Archive entries | 2000 |
| Unpacked tree | 128 MiB |
| Ignored | a macOS `__MACOSX/` folder; `mo addons package` also skips `.DS_Store`, `Thumbs.db`, `__pycache__` |
| Refused members | absolute paths, `..`, backslashes, symlinks, duplicate names |

## Testing

1. Install the folder or the archive — see [Add-ons](index.md) — and check that the new nodes appear in
   the palette.
2. Drop a node into a graph and confirm it validates, and that its `Show Information` text reads
   correctly.
3. Open the Firmware tab, tick the add-on under `Installed add-ons`, and press `Build`: the build stages
   the declared `mpAssets` and freezes them as `.mpy` in the image.
4. Deploy the collection; the `moa_*` modules upload as source when the image cannot serve them.

## Related

- [Add-ons](index.md) — installing, removing, and the archive limits.
- [Firmware view](../app/firmware-view.md) — building an image with the add-on selected.
- [Node reference](../nodes/index.md) — the page template for the nodes the package adds.
