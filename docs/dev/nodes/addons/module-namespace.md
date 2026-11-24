# Module Namespace

Every node package's device code lives in a **reserved module namespace**. There are exactly two:

| Prefix | Owner | Example |
|--------|-------|---------|
| `otter_*` | Micro-Otter built-ins | `otter_audio_viper`, `otter_led` |
| `moa_*` | Installed add-ons | `moa_hello`, `moa_pulse_viper` |

An add-on uses `moa_<id>` for its base implementation and `moa_<id>_<variant>` per variant. The
split is deliberately enforced — an add-on can **never** declare an `otter_*` root, so it cannot
overwrite a shipped module by name.

## What this means in practice

- The first path segment of every `mpAssets` entry must be `moa_<id>` (base) or
  `moa_<id>_<variant>` (variant). Anything else (`otter_*`, a bare folder, `libs/`, …) is rejected
  with `addon-module-root-invalid`.
- The editor's full node-type id is still `<id>.<type-id>` — the namespace only affects where the
  *device module* lives, not the node-type namespace.
- At build time the asset stages as `modules/moa_<id>/…` or `modules/moa_<id>_<variant>/…`; a stale
  `moa_*` module root is cleaned between builds so a base↔variant switch cannot leak files.
- The collection-deploy path classifies a library path by *namespace* (the shared
  `js/data/module-namespace.ts` predicate) — never by provenance — so `moa_*` modules deploy through
  the normal library path without the deploy layer learning about add-ons.

## The legacy `libs/` path

Built-in packages still use `libs/<name>/…` for some assets; that is a historical layout the
staging canonicaliser understands. Add-ons do not use it: their canonical root is `moa_`, full stop.
