# Add-on Node Packages — Authoring Guide

How to write an installable third-party node package. An add-on is a node package that a user
installs into their own folder (`Config.addons_dir`) instead of shipping inside
`src/micro_otter/nodes/device/node_pkgs`. It reuses the exact same manifest, node-definition,
generator, and capability machinery as a built-in package — an add-on is a node package that
happens to live somewhere else, plus one extra rule about its device-module namespace.

## The parts of an add-on

```text
<addons_dir>/
└── <id>/                          # one folder per package, named after the manifest "id"
    ├── manifest.json              # required — id, version, and every declared file
    ├── manifest.<variant>.json    # optional — one per variant implementation
    ├── node_definitions.json      # the node types (inputs/outputs/controls)
    ├── node_generators.js         # the code generator for those node types
    ├── node_capabilities.js       # optional — per-node capability-check handlers
    ├── data_types.json            # optional — connector type metadata
    ├── LICENSE                    # the licence the package ships (the examples ship GPL-3.0-only)
    └── moa_<id>/…                 # the MicroPython device module (see module namespace)
```

| Part | File | Purpose | Detail |
|------|------|---------|--------|
| Manifest | `manifest.json` | Declares the package and every file it ships. | [manifest.md](manifest.md) |
| Module namespace | `moa_<id>/…` | The reserved device-module root for add-ons. | [module-namespace.md](module-namespace.md) |
| Variants | `manifest.<variant>.json` | Alternative implementations of the same node set. | [variants.md](variants.md) |
| Node definitions | `node_definitions.json` | The node types and their connectors/controls. | [node-definitions.md](node-definitions.md) |
| Generators | `node_generators.js` | Turns a node into MicroPython code. | [generators.md](generators.md) |
| Capability checks | `node_capabilities.js` + `requiredCapabilities` | Gate a node/package/variant on the target. | [capability-checks.md](capability-checks.md) |
| Installation | `mo addons …` | Validate, install, list, uninstall. | [installation.md](installation.md) |
| Licence | `LICENSE` (+ `README.md`) | The package's own licence text; copied and archived verbatim. | [installation.md](installation.md#licence) |
| Build & deploy | — | Staging, `.mpy` compile, variant override, deploy. | [build-and-deploy.md](build-and-deploy.md) |

## The one rule that makes it an add-on

An add-on's device code must live under a **reserved `moa_` namespace** — `moa_<id>` for the base
implementation and `moa_<id>_<variant>` per variant. `otter_*` is reserved for Micro-Otter
built-ins, so an add-on can never overwrite a shipped module. Install validation rejects any
`mpAssets` path that does not obey this (`addon-module-root-invalid`).

## A minimal add-on

```json
{
    "id": "hello",
    "version": "1.0.0",
    "nodeDefs": "node_definitions.json",
    "generators": ["node_generators.js"],
    "mpAssets": { "*": ["moa_hello/__init__.py"] }
}
```

`mo addons validate ./hello` checks it; `mo addons install ./hello` publishes it; the Firmware tab
then lists it and builds it into an image exactly like a shipped package.

## Ship a licence

Every add-on is a redistribution of its author's code, so the package folder carries its own
`LICENSE` beside `manifest.json`. Nothing filters package files: `install_addon`, `mo addons package`,
and `validate_addon_tree` all copy the tree as it is, so a `LICENSE` (or `README.md`) travels into the
archive and into `<addons_dir>/<id>/` without a manifest entry. `tests/test_addon_invariants.py` keeps
`examples/addons/node_pkgs/{hello,pulse}/LICENSE` byte-identical to the repository `LICENSE`, and each
example node's `info` text names the licence, so **Show Information** states it without the user
opening the folder.

See the runnable examples under `examples/addons/node_pkgs/` — `hello` (single implementation) and
`pulse` (base + viper variant).

## Related

- [Node definition reference](../node-definition-reference.md) — the full node-type JSON schema.
- [Node validation architecture](../node-validation-architecture.md) — where a capability check lives.
- [Target capability schema](../target-capability-schema-reference.md) — the capability ids.
