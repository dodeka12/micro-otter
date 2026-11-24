# Changes since version 1.42.0

## New Features

- **User documentation site** — a new `user-docs/` tree is the only content MkDocs renders
  (`docs_dir: user-docs`, Material theme) and is organised into Home, Setup, App, Nodes and Addons,
  while the developer markdown under `docs/` stays raw and is reachable through `developer-docs.md`.
- **App guide** — `app/index.md` covers collections, graphs, graph modes and firmware, and one page
  per view documents the collection view, graph panel, console, device view, deploy view, firmware
  view and settings view.
- **Setup guide** — `setup/index.md` names the three installation modes (hosted app, local install,
  developer install) as placeholders until the packaging releases land, `targets.md` covers target
  selection and `connect.md` the device connection.
- **Node reference** — every node package has a page in the fixed package layout, and each of the 92
  node types has its own page following the node template (inputs, outputs, parameters, behaviour,
  example, see also); the port and parameter tables come from the package `node_definitions.json`,
  and the site navigation lists each package with its package page followed by its nodes.
- **Add-on authoring guide** — `addons/index.md` and `addons/create-package.md` describe the addon
  folder layout, the manifest, the reserved `moa_<id>` module namespace, packaging and testing, and
  `app/firmware-view.md` documents importing an addon.
- **Versioned publishing** — the `docs` dependency group pins MkDocs, MkDocs Material and `mike`,
  `mkdocs.yml` declares `extra.version.provider: mike`, and `npm run check:docs` runs the strict
  build as part of `npm run check:ci-local`.
